import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { 
  ArrowLeft, 
  Save, 
  Loader2, 
  Key, 
  Link2, 
  CheckCircle2, 
  AlertCircle,
  Eye,
  EyeOff,
  TestTube,
} from "lucide-react";

const PIX_PROVIDERS = [
  { value: "onz", label: "ONZ / Infopago" },
];

const PIX_KEY_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave Aleatória" },
];

interface PixConfig {
  id?: string;
  provider: string;
  client_id: string;
  client_secret_encrypted: string;
  base_url: string;
  pix_key: string;
  pix_key_type: "cpf" | "cnpj" | "email" | "phone" | "random";
  certificate_encrypted?: string;
  certificate_key_encrypted?: string;
  webhook_url?: string;
  webhook_secret?: string;
  is_sandbox: boolean;
  is_active: boolean;
}

export default function PixIntegration() {
  const { currentCompany, isAdmin } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [showSecrets, setShowSecrets] = useState(false);
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const [config, setConfig] = useState<PixConfig>({
    provider: "",
    client_id: "",
    client_secret_encrypted: "",
    base_url: "",
    pix_key: "",
    pix_key_type: "cpf",
    is_sandbox: true,
    is_active: true,
  });

  // Redirect if not admin
  useEffect(() => {
    if (!isAdmin) {
      navigate("/");
    }
  }, [isAdmin, navigate]);

  // Load existing config
  useEffect(() => {
    async function loadConfig() {
      if (!currentCompany) return;

      try {
        const { data, error } = await supabase
          .from("pix_configs")
          .select("*")
          .eq("company_id", currentCompany.id)
          .single();

        if (data) {
          setConfig({
            id: data.id,
            provider: data.provider,
            client_id: data.client_id,
            client_secret_encrypted: data.client_secret_encrypted,
            base_url: data.base_url,
            pix_key: data.pix_key,
            pix_key_type: data.pix_key_type,
            certificate_encrypted: data.certificate_encrypted || undefined,
            certificate_key_encrypted: data.certificate_key_encrypted || undefined,
            webhook_url: data.webhook_url || undefined,
            webhook_secret: data.webhook_secret || undefined,
            is_sandbox: data.is_sandbox,
            is_active: data.is_active,
          });
        }
      } catch (error) {
        // No config found, use defaults
      } finally {
        setIsLoading(false);
        setHasLoadedInitial(true);
      }
    }

    loadConfig();
  }, [currentCompany]);

  // Auto-save with debounce
  const autoSave = useCallback(() => {
    if (!hasLoadedInitial || !currentCompany || !config.provider) return;
    
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    
    autoSaveTimerRef.current = setTimeout(() => {
      handleSave(false);
    }, 1500);
  }, [hasLoadedInitial, currentCompany, config]);

  useEffect(() => {
    if (hasLoadedInitial) {
      autoSave();
    }
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [config, autoSave, hasLoadedInitial]);

  // Get default base URL for provider
  const getDefaultBaseUrl = (provider: string, sandbox: boolean): string => {
    const urls: Record<string, { production: string; sandbox: string }> = {
      onz: {
        production: "https://secureapi.bancodigital.onz.software/api/v2",
        sandbox: "https://secureapi.bancodigital.hmg.onz.software/api/v2",
      },
    };

    const providerUrls = urls[provider];
    if (providerUrls) {
      return sandbox ? providerUrls.sandbox : providerUrls.production;
    }
    return "";
  };

  // Handle provider change
  const handleProviderChange = (provider: string) => {
    const baseUrl = getDefaultBaseUrl(provider, config.is_sandbox);
    setConfig({ ...config, provider, base_url: baseUrl || config.base_url });
  };

  // Handle sandbox toggle
  const handleSandboxChange = (sandbox: boolean) => {
    const baseUrl = getDefaultBaseUrl(config.provider, sandbox);
    setConfig({ ...config, is_sandbox: sandbox, base_url: baseUrl || config.base_url });
  };

  // Test connection
  const handleTestConnection = async () => {
    if (!currentCompany) return;

    setIsTesting(true);
    setTestResult(null);

    try {
      // First save the config
      await handleSave(false);

      // Then test authentication
      const { data, error } = await supabase.functions.invoke("pix-auth", {
        body: { company_id: currentCompany.id },
      });

      if (error || !data?.access_token) {
        setTestResult("error");
        toast({
          variant: "destructive",
          title: "Falha na conexão",
          description: data?.error || "Não foi possível autenticar com o provedor.",
        });
      } else {
        setTestResult("success");
        toast({
          title: "Conexão bem-sucedida!",
          description: "As credenciais foram validadas com o provedor Pix.",
        });
      }
    } catch (error) {
      setTestResult("error");
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Falha ao testar a conexão.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Save config
  const handleSave = async (showNotification = true) => {
    if (!currentCompany) return;

    setIsSaving(true);

    try {
      const configData = {
        company_id: currentCompany.id,
        provider: config.provider,
        client_id: config.client_id,
        client_secret_encrypted: config.client_secret_encrypted,
        base_url: config.base_url,
        pix_key: config.pix_key,
        pix_key_type: config.pix_key_type,
        certificate_encrypted: config.certificate_encrypted || null,
        certificate_key_encrypted: config.certificate_key_encrypted || null,
        webhook_url: config.webhook_url || null,
        webhook_secret: config.webhook_secret || null,
        is_sandbox: config.is_sandbox,
        is_active: config.is_active,
      };

      let error;
      
      if (config.id) {
        // Update existing
        const result = await supabase
          .from("pix_configs")
          .update(configData)
          .eq("id", config.id);
        error = result.error;
      } else {
        // Insert new
        const result = await supabase
          .from("pix_configs")
          .insert(configData)
          .select()
          .single();
        
        if (result.data) {
          setConfig({ ...config, id: result.data.id });
        }
        error = result.error;
      }

      if (error) {
        throw error;
      }

      if (showNotification) {
        toast({
          title: "Configurações salvas!",
          description: "As configurações do Pix foram atualizadas.",
        });
      }
    } catch (error: any) {
      console.error("Error saving config:", error);
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: error.message || "Tente novamente.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Generate webhook URL
  const webhookUrl = currentCompany 
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pix-webhook`
    : "";

  if (isLoading) {
    return (
      <MainLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="icon" onClick={() => navigate("/settings")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Integração Pix</h1>
            <p className="text-muted-foreground">
              Configure a conexão com seu provedor de pagamentos Pix
            </p>
          </div>
        </div>

        <div className="space-y-6">
          {/* Provider Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Provedor de Pagamentos
              </CardTitle>
              <CardDescription>
                Selecione o banco ou instituição de pagamentos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Provedor</Label>
                  <Select
                    value={config.provider}
                    onValueChange={handleProviderChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o provedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {PIX_PROVIDERS.map((provider) => (
                        <SelectItem key={provider.value} value={provider.value}>
                          {provider.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Ambiente</Label>
                  <div className="flex items-center gap-4 h-10">
                    <Switch
                      checked={config.is_sandbox}
                      onCheckedChange={handleSandboxChange}
                    />
                    <span className="text-sm">
                      {config.is_sandbox ? (
                        <span className="text-warning">Sandbox (Testes)</span>
                      ) : (
                        <span className="text-success">Produção</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>URL Base da API</Label>
                <Input
                  value={config.base_url}
                  onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                  placeholder="https://api.provedor.com.br/pix/v2"
                />
              </div>
            </CardContent>
          </Card>

          {/* Credentials */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Credenciais OAuth2
              </CardTitle>
              <CardDescription>
                Credenciais de autenticação da API (Client Credentials)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Client ID</Label>
                  <Input
                    value={config.client_id}
                    onChange={(e) => setConfig({ ...config, client_id: e.target.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                  <p className="text-xs text-muted-foreground">
                    Formato UUID (ex: 12345678-abcd-efgh-ijkl-123456789012). Consulte o portal ONZ.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Client Secret</Label>
                  <div className="relative">
                    <Input
                      type={showSecrets ? "text" : "password"}
                      value={config.client_secret_encrypted}
                      onChange={(e) => setConfig({ ...config, client_secret_encrypted: e.target.value })}
                      placeholder="Seu Client Secret"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecrets(!showSecrets)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Certificado mTLS (Base64)</Label>
                <Textarea
                  value={config.certificate_encrypted || ""}
                  onChange={(e) => setConfig({ ...config, certificate_encrypted: e.target.value })}
                  placeholder="Cole aqui o certificado .crt em Base64 (obrigatório para ONZ)"
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Chave do Certificado (Base64)</Label>
                <Textarea
                  value={config.certificate_key_encrypted || ""}
                  onChange={(e) => setConfig({ ...config, certificate_key_encrypted: e.target.value })}
                  placeholder="Cole aqui a chave do certificado .key em Base64 (obrigatório para ONZ)"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          {/* Pix Key */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Chave Pix de Recebimento
              </CardTitle>
              <CardDescription>
                Chave Pix que será usada para receber os pagamentos
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tipo de Chave</Label>
                  <Select
                    value={config.pix_key_type}
                    onValueChange={(v) => setConfig({ ...config, pix_key_type: v as "cpf" | "cnpj" | "email" | "phone" | "random" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PIX_KEY_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Chave Pix</Label>
                  <Input
                    value={config.pix_key}
                    onChange={(e) => setConfig({ ...config, pix_key: e.target.value })}
                    placeholder="Sua chave Pix"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Webhook */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-5 w-5 text-primary" />
                Webhook
              </CardTitle>
              <CardDescription>
                Configure o webhook para receber notificações de pagamento
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>URL do Webhook (copie para configurar no provedor)</Label>
                <div className="flex gap-2">
                  <Input value={webhookUrl} readOnly />
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      toast({ title: "URL copiada!" });
                    }}
                  >
                    Copiar
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Secret do Webhook (opcional)</Label>
                <Input
                  type={showSecrets ? "text" : "password"}
                  value={config.webhook_secret || ""}
                  onChange={(e) => setConfig({ ...config, webhook_secret: e.target.value })}
                  placeholder="Chave secreta para validar webhooks"
                />
              </div>
            </CardContent>
          </Card>

          {/* Status & Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Status da Integração</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={config.is_active}
                    onCheckedChange={(v) => setConfig({ ...config, is_active: v })}
                  />
                  <span>Integração {config.is_active ? "ativa" : "desativada"}</span>
                </div>

                {testResult && (
                  <div className={`flex items-center gap-2 ${
                    testResult === "success" ? "text-success" : "text-destructive"
                  }`}>
                    {testResult === "success" ? (
                      <>
                        <CheckCircle2 className="h-5 w-5" />
                        <span>Conexão OK</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-5 w-5" />
                        <span>Falha na conexão</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={isTesting || !config.provider || !config.client_id}
                >
                  {isTesting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Testando...
                    </>
                  ) : (
                    <>
                      <TestTube className="mr-2 h-4 w-4" />
                      Testar Conexão
                    </>
                  )}
                </Button>

                <Button
                  className="flex-1 bg-gradient-primary hover:opacity-90"
                  onClick={() => handleSave(true)}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Salvar Configurações
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </MainLayout>
  );
}
