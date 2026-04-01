import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { cn, formatCurrency } from "@/lib/utils";
import { invalidateDashboardCache } from "@/hooks/useDashboardData";
import { usePixPayment } from "@/hooks/usePixPayment";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Camera,
  Upload,
  FileText,
  DollarSign,
  TrendingUp,
  Loader2,
  Check,
  AlertCircle,
  X,
  Search,
} from "lucide-react";

type ClassificationType = "cost" | "expense";

interface ReceiptData {
  file: File | null;
  previewUrl: string | null;
  classification: ClassificationType | null;
  subcategory: string | null;
  isProcessing: boolean;
}

interface CategoryRecord {
  id: string;
  name: string;
  classification: "cost" | "expense";
}

export default function ReceiptCapture() {
  const { transactionId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { currentCompany, hasFeatureAccess, isAdmin } = useAuth();
  const { checkStatus } = usePixPayment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [categoryUsageCounts, setCategoryUsageCounts] = useState<Record<string, number>>({});
  const [transactionStatus, setTransactionStatus] = useState<string | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [transactionPixType, setTransactionPixType] = useState<string | null>(null);
  const [transactionInfo, setTransactionInfo] = useState<{
    beneficiary_name: string | null;
    amount: number | null;
    created_at: string | null;
    description: string | null;
  }>({ beneficiary_name: null, amount: null, created_at: null, description: null });
  const [paymentDescription, setPaymentDescription] = useState("");

  // Check transaction status — only allow receipt attachment if completed
  useEffect(() => {
    if (!transactionId) return;

    let isMounted = true;
    setIsLoadingStatus(true);

    const loadTransactionStatus = async (syncWithProvider = false) => {
      const { data } = await supabase
        .from("transactions")
        .select("status, pix_type, beneficiary_name, amount, created_at, description")
        .eq("id", transactionId)
        .single();

      const currentStatus = data?.status || null;
      if (data?.pix_type) setTransactionPixType(data.pix_type);
      if (data) {
        setTransactionInfo({
          beneficiary_name: data.beneficiary_name ?? null,
          amount: data.amount ? Number(data.amount) : null,
          created_at: data.created_at ?? null,
          description: data.description ?? null,
        });
        if (data.description && !paymentDescription) {
          setPaymentDescription(data.description);
        }
      }

      if (!isMounted) return currentStatus;

      setTransactionStatus(currentStatus);

      const shouldSyncProvider =
        syncWithProvider &&
        currentCompany?.id &&
        currentStatus !== "completed" &&
        currentStatus !== "failed" &&
        currentStatus !== "cancelled";

      if (shouldSyncProvider) {
        const providerStatus = await checkStatus(transactionId, true);
        const syncedStatus = providerStatus?.internal_status || currentStatus;

        if (!isMounted) return syncedStatus;

        if (syncedStatus && syncedStatus !== currentStatus) {
          setTransactionStatus(syncedStatus);
        }

        setIsLoadingStatus(false);
        return syncedStatus;
      }

      setIsLoadingStatus(false);
      return currentStatus;
    };

    loadTransactionStatus(true);

    let pollCount = 0;

    // Poll every 3s if not yet completed
    const interval = setInterval(async () => {
      pollCount += 1;
      const status = await loadTransactionStatus(pollCount % 2 === 0);

      if (status === "completed" || status === "failed" || status === "cancelled") {
        clearInterval(interval);
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [transactionId, currentCompany?.id, checkStatus]);

  useEffect(() => {
    if (!currentCompany) return;

    // Load categories and usage counts in parallel
    Promise.all([
      supabase
        .from("categories")
        .select("id, name, classification")
        .eq("company_id", currentCompany.id)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("transactions")
        .select("category_id")
        .eq("company_id", currentCompany.id)
        .not("category_id", "is", null),
    ]).then(([catRes, txRes]) => {
      if (catRes.data) setCategories(catRes.data as CategoryRecord[]);
      if (txRes.data) {
        const counts: Record<string, number> = {};
        for (const row of txRes.data) {
          const cid = row.category_id as string;
          counts[cid] = (counts[cid] || 0) + 1;
        }
        setCategoryUsageCounts(counts);
      }
    });
  }, [currentCompany]);

  // Permission-based classification
  const canClassifyCost = isAdmin || hasFeatureAccess("classificar_insumo");
  const canClassifyExpense = isAdmin || hasFeatureAccess("classificar_despesa");
  const hasNoClassificationAccess = !canClassifyCost && !canClassifyExpense;
  const hasBothClassifications = canClassifyCost && canClassifyExpense;
  const hasOnlyOneClassification = (canClassifyCost || canClassifyExpense) && !hasBothClassifications;
  const autoClassification: ClassificationType | null = hasOnlyOneClassification
    ? (canClassifyCost ? "cost" : "expense")
    : null;

  const [receiptData, setReceiptData] = useState<ReceiptData>({
    file: null,
    previewUrl: null,
    classification: null,
    subcategory: null,
    isProcessing: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const normalizeImageOrientation = useCallback(async (file: File): Promise<{ blob: Blob; previewUrl: string }> => {
    // Only process image files
    if (!file.type.startsWith("image/")) {
      const previewUrl = URL.createObjectURL(file);
      return { blob: file, previewUrl };
    }

    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();

    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9);
    });

    const previewUrl = URL.createObjectURL(blob);
    return { blob, previewUrl };
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    setReceiptData((prev) => ({ ...prev, isProcessing: true }));

    // Normalize orientation via Canvas (fixes mobile EXIF rotation)
    const { blob, previewUrl } = await normalizeImageOrientation(file);

    // Build a corrected File object preserving the original name
    const fileName = file.name.replace(/\.[^.]+$/, ".jpg");
    const correctedFile = new File([blob], fileName, { type: "image/jpeg" });

    setReceiptData((prev) => ({
      ...prev,
      file: correctedFile,
      previewUrl,
      isProcessing: false,
      // Auto-set classification if user only has one permission
      classification: autoClassification ?? prev.classification,
    }));
  }, [normalizeImageOrientation]);

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleSaveWithoutReceipt = async () => {
    if (!receiptData.classification) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Selecione a classificação antes de salvar.",
      });
      return;
    }

    if (!paymentDescription.trim()) {
      toast({
        variant: "destructive",
        title: "Descrição obrigatória",
        description: "Descreva o que foi pago para poder anexar o comprovante depois.",
      });
      return;
    }

    if (!transactionId || !currentCompany) {
      toast({ variant: "destructive", title: "Erro", description: "Transação ou empresa não encontrada." });
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      const updateData: Record<string, any> = {
        description: paymentDescription.trim(),
        classified_at: new Date().toISOString(),
      };

      if (receiptData.subcategory) {
        const selectedCategory = categories.find(
          (c) => c.name === receiptData.subcategory && c.classification === receiptData.classification
        );
        if (selectedCategory) {
          updateData.category_id = selectedCategory.id;
          updateData.classified_by = user.id;
        }
      }

      await supabase
        .from("transactions")
        .update(updateData)
        .eq("id", transactionId);

      invalidateDashboardCache();
      toast({
        title: "Classificação salva!",
        description: "O comprovante ficou pendente para anexar depois.",
      });
      navigate("/");
    } catch (error: any) {
      console.error("Erro ao salvar classificação:", error);
      toast({ variant: "destructive", title: "Erro ao salvar", description: error.message || "Tente novamente." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!receiptData.file) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Anexe um comprovante.",
      });
      return;
    }

    if (!hasNoClassificationAccess && !receiptData.classification) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Selecione a classificação.",
      });
      return;
    }

    if (!transactionId || !currentCompany) {
      toast({ variant: "destructive", title: "Erro", description: "Transação ou empresa não encontrada." });
      return;
    }

    setIsSubmitting(true);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Usuário não autenticado");

      // Upload file to storage
      const timestamp = Date.now();
      const filePath = `${currentCompany.id}/${transactionId}/${timestamp}_${receiptData.file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(filePath, receiptData.file);

      if (uploadError) throw uploadError;

      // Save relative path (bucket is private, signed URLs generated on demand)
      // Insert receipt record
      const { error: receiptError } = await supabase
        .from("receipts")
        .insert({
          transaction_id: transactionId,
          file_url: filePath,
          file_name: receiptData.file.name,
          file_type: receiptData.file.type,
          uploaded_by: user.id,
          ocr_status: "pending" as const,
        });

      if (receiptError) throw receiptError;

      // Status is already set by the payment provider confirmation — do not override here

      // Update category and description on transaction
      const txUpdate: Record<string, any> = {};
      if (paymentDescription.trim()) {
        txUpdate.description = paymentDescription.trim();
      }
      if (receiptData.subcategory) {
        const selectedCategory = categories.find(
          (c) => c.name === receiptData.subcategory && c.classification === receiptData.classification
        );
        if (selectedCategory) {
          txUpdate.category_id = selectedCategory.id;
          txUpdate.classified_by = user.id;
          txUpdate.classified_at = new Date().toISOString();
        }
      }
      if (Object.keys(txUpdate).length > 0) {
        await supabase.from("transactions").update(txUpdate).eq("id", transactionId);
      }

      invalidateDashboardCache();

      toast({
        title: "Comprovante salvo!",
        description: "A transação foi classificada com sucesso.",
      });

      navigate("/transactions");
    } catch (error: any) {
      console.error("Erro ao salvar comprovante:", error);
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: error.message || "Tente novamente.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveFile = () => {
    if (receiptData.previewUrl) {
      URL.revokeObjectURL(receiptData.previewUrl);
    }
    setReceiptData({
      file: null,
      previewUrl: null,
      classification: null,
      subcategory: null,
      isProcessing: false,
    });
  };

  const canSubmit = hasNoClassificationAccess
    ? receiptData.file && !receiptData.isProcessing
    : receiptData.file && receiptData.classification && !receiptData.isProcessing;
  const canSaveWithoutReceipt = !hasNoClassificationAccess && receiptData.classification && !receiptData.isProcessing;

  // Guard: auto-redirect for probe transactions (R$ 0,01)
  const isProbeTransaction = transactionInfo.amount != null && transactionInfo.amount <= 0.01;

  // Guard: show waiting screen if transaction is not yet completed
  const isTransactionCompleted = transactionStatus === "completed";
  const isTransactionFinalFailed = transactionStatus === "failed" || transactionStatus === "cancelled";

  // Auto-redirect probes
  useEffect(() => {
    if (!isLoadingStatus && isProbeTransaction) {
      toast({
        title: "Verificação de dados",
        description: "Transações de verificação (R$ 0,01) não requerem comprovante.",
      });
      navigate("/");
    }
  }, [isLoadingStatus, isProbeTransaction, navigate, toast]);

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Anexar Comprovante</h1>
          <p className="text-muted-foreground">
            Capture ou anexe o comprovante fiscal e classifique o pagamento
          </p>
        </div>

        {/* Loading status */}
        {isLoadingStatus && (
          <Card className="mb-6">
            <CardContent className="flex flex-col items-center gap-3 p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Verificando status do pagamento...</p>
            </CardContent>
          </Card>
        )}

        {/* Transaction failed/cancelled */}
        {!isLoadingStatus && isTransactionFinalFailed && (
          <Card className="border-destructive/50 bg-destructive/5 mb-6">
            <CardContent className="flex flex-col items-center gap-3 p-8">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="font-medium">Pagamento não confirmado</p>
              <p className="text-sm text-muted-foreground text-center">
                Este pagamento foi {transactionStatus === "failed" ? "recusado" : "cancelado"}. Não é possível anexar comprovante.
              </p>
              <Button variant="outline" onClick={() => navigate("/")}>
                Voltar ao Início
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Waiting for confirmation */}
        {!isLoadingStatus && !isTransactionCompleted && !isTransactionFinalFailed && (
          <Card className="border-primary/30 bg-primary/5 mb-6">
            <CardContent className="flex flex-col items-center gap-3 p-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="font-medium">Aguardando confirmação do pagamento</p>
              <p className="text-sm text-muted-foreground text-center">
                O comprovante só pode ser anexado após a confirmação oficial do pagamento pelo provedor.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Only show receipt capture when transaction is confirmed */}
        {!isLoadingStatus && isTransactionCompleted && (
          <>
        {/* Transaction identification card — REFORÇADO */}
        <Card className="border-warning/60 bg-warning/10 mb-6 shadow-md">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle className="h-5 w-5 text-warning" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-wider text-warning mb-1">
                  ⚠ Pendente: Nota Fiscal
                </p>
                <p className="text-lg font-bold text-foreground">
                  {transactionInfo.beneficiary_name || "Destinatário não identificado"}
                </p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-2xl font-bold font-mono-numbers text-primary">
                    {transactionInfo.amount != null ? formatCurrency(transactionInfo.amount) : "—"}
                  </span>
                </div>
                {transactionInfo.created_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(transactionInfo.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Alert */}
        <Card className="border-warning/50 bg-warning/5 mb-6">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="font-medium">Anexar Comprovante</p>
              <p className="text-sm text-muted-foreground">
                Anexe o comprovante fiscal e classifique o pagamento. Você pode salvar a classificação agora e anexar a foto depois.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Capture options or Preview */}
        {!receiptData.file ? (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Capturar Comprovante</CardTitle>
              <CardDescription>
                Tire uma foto do cupom/nota ou anexe um arquivo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Camera button */}
                <Button
                  variant="outline"
                  size="lg"
                  className="h-32 flex-col gap-3"
                  onClick={() => cameraInputRef.current?.click()}
                >
                  <Camera className="h-10 w-10 text-primary" />
                  <span>Tirar Foto</span>
                </Button>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handleCameraCapture}
                />

                {/* Upload button */}
                <Button
                  variant="outline"
                  size="lg"
                  className="h-32 flex-col gap-3"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-10 w-10 text-primary" />
                  <span>Anexar Arquivo</span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Preview */}
            <Card className="mb-6 overflow-hidden">
              <div className="relative">
                {receiptData.previewUrl && (
                  <img
                    src={receiptData.previewUrl}
                    alt="Comprovante"
                    className="w-full h-64 object-cover"
                  />
                )}
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-4 right-4"
                  onClick={handleRemoveFile}
                  disabled={isSubmitting}
                >
                  <X className="h-4 w-4" />
                </Button>

              </div>
            </Card>

            {/* Classification */}
            {hasNoClassificationAccess ? (
              <Card className="mb-6 border-primary/30 bg-primary/5">
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">Classificação pendente</p>
                    <p className="text-sm text-muted-foreground">
                      A classificação contábil será realizada pelo gestor. Anexe o comprovante para prosseguir.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
            <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Classificar Pagamento</CardTitle>
                  <CardDescription>
                    {hasOnlyOneClassification
                      ? "Classificação definida automaticamente com base nas suas permissões"
                      : "Selecione se é um Custo ou Despesa"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Auto-classification notice */}
                  {hasOnlyOneClassification && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
                      <Badge variant="secondary" className="text-sm px-3 py-1">
                        Categoria: {autoClassification === "cost" ? "Custo" : "Despesa"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">Definida automaticamente</span>
                    </div>
                  )}

                  {/* Main classification buttons — only show when user has both permissions */}
                  {hasBothClassifications && (
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      variant={
                        receiptData.classification === "cost"
                          ? "default"
                          : "outline"
                      }
                      size="lg"
                      className={cn(
                        "h-20 flex-col gap-2",
                        receiptData.classification === "cost" &&
                          "bg-gradient-primary shadow-primary"
                      )}
                      onClick={() => {
                        setReceiptData((prev) => ({
                          ...prev,
                          classification: "cost",
                          subcategory: null,
                        }));
                        setCategorySearch("");
                        setShowAllCategories(false);
                      }}
                    >
                      <DollarSign className="h-6 w-6" />
                      <span className="font-bold">CUSTO</span>
                    </Button>

                    <Button
                      variant={
                        receiptData.classification === "expense"
                          ? "default"
                          : "outline"
                      }
                      size="lg"
                      className={cn(
                        "h-20 flex-col gap-2",
                        receiptData.classification === "expense" &&
                          "bg-destructive hover:bg-destructive/90"
                      )}
                      onClick={() => {
                        setReceiptData((prev) => ({
                          ...prev,
                          classification: "expense",
                          subcategory: null,
                        }));
                        setCategorySearch("");
                        setShowAllCategories(false);
                      }}
                    >
                      <TrendingUp className="h-6 w-6" />
                      <span className="font-bold">DESPESA</span>
                    </Button>
                  </div>
                  )}

                  {/* Subcategories */}
                  {receiptData.classification && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Categoria</label>
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Buscar categoria..."
                          value={categorySearch}
                          onChange={(e) => setCategorySearch(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(() => {
                          const filtered = categories
                            .filter((c) => c.classification === receiptData.classification)
                            .filter((c) => c.name.toLowerCase().includes(categorySearch.toLowerCase()))
                            .sort((a, b) => {
                              const countA = categoryUsageCounts[a.id] || 0;
                              const countB = categoryUsageCounts[b.id] || 0;
                              if (countB !== countA) return countB - countA;
                              return a.name.localeCompare(b.name);
                            });

                          const isSearching = categorySearch.trim().length > 0;
                          const visible = isSearching || showAllCategories ? filtered : filtered.slice(0, 8);
                          const hasMore = filtered.length > 8;

                          return (
                            <>
                              {visible.map((cat) => (
                                <Button
                                  key={cat.id}
                                  variant={receiptData.subcategory === cat.name ? "default" : "outline"}
                                  size="sm"
                                  onClick={() =>
                                    setReceiptData((prev) => ({ ...prev, subcategory: cat.name }))
                                  }
                                >
                                  {cat.name}
                                </Button>
                              ))}
                              {visible.length === 0 && (
                                <p className="text-sm text-muted-foreground py-2">Nenhuma categoria encontrada</p>
                              )}
                              {hasMore && !isSearching && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-primary"
                                  onClick={() => setShowAllCategories((v) => !v)}
                                >
                                  {showAllCategories ? "Ver menos" : `Ver todas (${filtered.length})`}
                                </Button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}
                </CardContent>
            </Card>
            )}
          </>
        )}
        {/* Description field */}
        <Card className="mb-6">
          <CardContent className="p-4 space-y-2">
            <label className="text-sm font-medium">
              O que foi pago? {!receiptData.file && <span className="text-destructive">*</span>}
            </label>
            <Textarea
              placeholder="Ex: Compra de tomate, Conta de luz, Material de limpeza..."
              value={paymentDescription}
              onChange={(e) => setPaymentDescription(e.target.value)}
              maxLength={200}
              className="resize-none"
              rows={2}
            />
            <p className="text-[10px] text-muted-foreground">
              {!receiptData.file
                ? "Obrigatório ao salvar sem comprovante — ajuda a lembrar qual foto anexar depois."
                : "Opcional — adicione uma descrição para facilitar a identificação."}
            </p>
          </CardContent>
        </Card>


        <div className="space-y-3">
          <Button
            className="w-full bg-gradient-accent hover:opacity-90 shadow-accent text-lg h-14"
            disabled={!canSubmit || isSubmitting}
            onClick={handleSubmit}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Check className="mr-2 h-5 w-5" />
                Salvar Comprovante
              </>
            )}
          </Button>

          {/* Contingency: save without photo */}
          {!receiptData.file && canSaveWithoutReceipt && (
            <Button
              variant="outline"
              className="w-full h-12 text-sm"
              disabled={isSubmitting}
              onClick={handleSaveWithoutReceipt}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar classificação sem comprovante"
              )}
            </Button>
          )}
        </div>
          </>
        )}
      </div>
    </MainLayout>
  );
}
