import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
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
  Sparkles,
} from "lucide-react";

type ClassificationType = "cost" | "expense";

interface ReceiptData {
  file: File | null;
  previewUrl: string | null;
  classification: ClassificationType | null;
  subcategory: string | null;
  ocrData: {
    cnpj?: string;
    date?: string;
    value?: string;
    accessKey?: string;
    suggestedCategory?: string;
  } | null;
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
  const { currentCompany } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);

  useEffect(() => {
    if (!currentCompany) return;
    supabase
      .from("categories")
      .select("id, name, classification")
      .eq("company_id", currentCompany.id)
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setCategories(data as CategoryRecord[]);
      });
  }, [currentCompany]);

  const [receiptData, setReceiptData] = useState<ReceiptData>({
    file: null,
    previewUrl: null,
    classification: null,
    subcategory: null,
    ocrData: null,
    isProcessing: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileSelect = useCallback(async (file: File) => {
    // Create preview URL
    const previewUrl = URL.createObjectURL(file);

    setReceiptData((prev) => ({
      ...prev,
      file,
      previewUrl,
      isProcessing: true,
    }));

    // Simulate OCR processing
    // In production, this would call the OCR edge function
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Simulated OCR result
    const mockOcrData = {
      cnpj: "12.345.678/0001-90",
      date: "2024-01-15",
      value: "R$ 2.450,00",
      accessKey: "35240112345678000190550010000001231234567890",
      suggestedCategory: "Insumos",
    };

    setReceiptData((prev) => ({
      ...prev,
      ocrData: mockOcrData,
      classification: "cost" as ClassificationType, // AI suggestion
      isProcessing: false,
    }));

    toast({
      title: "Comprovante processado!",
      description: "Os dados foram extraídos automaticamente pela IA.",
    });
  }, [toast]);

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

  const handleSubmit = async () => {
    if (!receiptData.file || !receiptData.classification) {
      toast({
        variant: "destructive",
        title: "Erro",
        description: "Anexe um comprovante e selecione a classificação.",
      });
      return;
    }

    setIsSubmitting(true);

    // Simulate upload and save
    await new Promise((resolve) => setTimeout(resolve, 1500));

    toast({
      title: "Comprovante salvo!",
      description: "A transação foi classificada com sucesso.",
    });

    navigate("/");
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
      ocrData: null,
      isProcessing: false,
    });
  };

  const canSubmit = receiptData.file && receiptData.classification && !receiptData.isProcessing;

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

        {/* Alert */}
        <Card className="border-warning/50 bg-warning/5 mb-6">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="h-10 w-10 rounded-full bg-warning/20 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <p className="font-medium">Comprovante Obrigatório</p>
              <p className="text-sm text-muted-foreground">
                Você não pode sair desta tela sem anexar o comprovante.
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

                {/* Processing overlay */}
                {receiptData.isProcessing && (
                  <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                    <div className="text-center">
                      <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary mb-4" />
                      <p className="font-medium">Processando comprovante...</p>
                      <p className="text-sm text-muted-foreground">
                        Extraindo dados com IA
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* OCR Data */}
              {receiptData.ocrData && !receiptData.isProcessing && (
                <CardContent className="p-4 space-y-3 bg-muted/30">
                  <div className="flex items-center gap-2 text-sm text-primary">
                    <Sparkles className="h-4 w-4" />
                    <span className="font-medium">Dados extraídos por IA</span>
                  </div>

                  <div className="grid gap-2 text-sm">
                    {receiptData.ocrData.cnpj && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">CNPJ</span>
                        <span className="font-mono">{receiptData.ocrData.cnpj}</span>
                      </div>
                    )}
                    {receiptData.ocrData.value && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Valor</span>
                        <span className="font-bold">{receiptData.ocrData.value}</span>
                      </div>
                    )}
                    {receiptData.ocrData.date && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Data</span>
                        <span>{receiptData.ocrData.date}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Classification */}
            {!receiptData.isProcessing && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>Classificar Pagamento</CardTitle>
                  <CardDescription>
                    Selecione se é um Custo ou Despesa
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Main classification */}
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
                      onClick={() =>
                        setReceiptData((prev) => ({
                          ...prev,
                          classification: "cost",
                          subcategory: null,
                        }))
                      }
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
                      onClick={() =>
                        setReceiptData((prev) => ({
                          ...prev,
                          classification: "expense",
                          subcategory: null,
                        }))
                      }
                    >
                      <TrendingUp className="h-6 w-6" />
                      <span className="font-bold">DESPESA</span>
                    </Button>
                  </div>

                  {/* Subcategories */}
                  {receiptData.classification && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Categoria</label>
                      <div className="flex flex-wrap gap-2">
                        {categories
                          .filter((c) => c.classification === receiptData.classification)
                          .map((cat) => (
                          <Button
                            key={cat.id}
                            variant={
                              receiptData.subcategory === cat.name
                                ? "default"
                                : "outline"
                            }
                            size="sm"
                            onClick={() =>
                              setReceiptData((prev) => ({
                                ...prev,
                                subcategory: cat.name,
                              }))
                            }
                          >
                            {cat.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Submit button */}
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
      </div>
    </MainLayout>
  );
}
