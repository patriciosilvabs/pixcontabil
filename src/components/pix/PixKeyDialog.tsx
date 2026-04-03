import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Key, DollarSign, CheckCircle2, ShieldCheck, UserCheck, CreditCard, X, QrCode, Search } from "lucide-react";
import { toast } from "sonner";
import { usePixPayment } from "@/hooks/usePixPayment";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseLocalizedNumber, isValidPaymentAmount } from "@/lib/utils";
import { PaymentStatusScreen } from "./PaymentStatusScreen";
import { useQuickTags } from "@/hooks/useQuickTags";
import { detectPixKeyType, type PixKeyType } from "@/lib/pix-utils";
import { Skeleton } from "@/components/ui/skeleton";

interface Favorite {
  beneficiary_name: string;
  beneficiary_document: string | null;
  pix_key: string;
  pix_key_type: string | null;
  initials: string;
  count: number;
}

interface PixKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;

function maskDocument(doc: string | null): string {
  if (!doc) return "";
  const clean = doc.replace(/\D/g, "");
  if (clean.length === 11) {
    return `***${clean.slice(3, 6)}.${clean.slice(6, 9)}-**`;
  }
  if (clean.length === 14) {
    return `**.***.${clean.slice(4, 7)}/${clean.slice(7, 11)}-**`;
  }
  return doc;
}

// Mock favorites for UI (will be replaced with DB query later)
const MOCK_FAVORITES = [
  { id: "1", name: "Maria Silva", initials: "MS", institution: "Nubank" },
  { id: "2", name: "João Santos", initials: "JS", institution: "Bradesco" },
  { id: "3", name: "Ana Costa", initials: "AC", institution: "Itaú" },
];

export function PixKeyDialog({ open, onOpenChange }: PixKeyDialogProps) {
  const navigate = useNavigate();
  const { payByKey, checkStatus, getTransactionBeneficiary, isProcessing } = usePixPayment();
  const { hasPageAccess } = useAuth();
  const { tags: quickTags } = useQuickTags();
  const [step, setStep] = useState<Step>(1);
  const [pixKeyType, setPixKeyType] = useState<PixKeyType | null>(null);
  const [pixKey, setPixKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [amount, setAmount] = useState("");
  const [saveFavorite, setSaveFavorite] = useState(false);
  const [description, setDescription] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [showOrderInput, setShowOrderInput] = useState(false);
  const [suggestedClassification, setSuggestedClassification] = useState<string | null>(null);
  const [receiptRequired, setReceiptRequired] = useState(true);
  const [descriptionPlaceholder, setDescriptionPlaceholder] = useState("Ex: Pagamento fornecedor");
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [descriptionRequired, setDescriptionRequired] = useState(true);

  // Probe state
  const [probeTransactionId, setProbeTransactionId] = useState("");
  const [probeError, setProbeError] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState<string | null>(null);
  const [beneficiaryDocument, setBeneficiaryDocument] = useState<string | null>(null);
  const probePollingRef = useRef<NodeJS.Timeout | null>(null);
  const probeMountedRef = useRef(true);

  // Real payment state
  const [realTransactionId, setRealTransactionId] = useState("");

  const handleClose = () => {
    stopProbePolling();
    setPixKeyType(null);
    setPixKey("");
    setKeyError("");
    setDescription("");
    setSaveFavorite(false);
    setOrderNumber("");
    setShowOrderInput(false);
    setSuggestedClassification(null);
    setReceiptRequired(true);
    setDescriptionPlaceholder("Ex: Pagamento fornecedor");
    setSelectedTagId(null);
    setDescriptionRequired(true);
    setProbeTransactionId("");
    setProbeError("");
    setBeneficiaryName(null);
    setBeneficiaryDocument(null);
    setRealTransactionId("");
    setStep(1);
    onOpenChange(false);
  };

  const handleCloseAndNavigate = () => {
    handleClose();
    const nextRoute = hasPageAccess("transactions") ? "/transactions" : "/";
    navigate(nextRoute);
  };

  const stopProbePolling = useCallback(() => {
    if (probePollingRef.current) {
      clearInterval(probePollingRef.current);
      probePollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    probeMountedRef.current = true;
    return () => {
      probeMountedRef.current = false;
      stopProbePolling();
    };
  }, [stopProbePolling]);

  const handleBack = () => {
    if (step === 1 || step === 6) {
      handleClose();
    } else if (step === 3) {
      return;
    } else if (step === 4) {
      setStep(2);
    } else if (step === 5) {
      return;
    } else {
      setStep((s) => (s - 1) as Step);
    }
  };

  const handleStep1Submit = () => {
    const trimmed = pixKey.trim();
    if (!trimmed) {
      toast.error("Informe a chave Pix");
      return;
    }
    const detected = detectPixKeyType(trimmed);
    if (!detected) {
      setKeyError("Formato de chave não reconhecido");
      return;
    }
    setPixKeyType(detected);
    setStep(2);
  };

  const handleStep2 = () => {
    const value = parseLocalizedNumber(amount);
    const validation = isValidPaymentAmount(value);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    if (quickTags.length > 0 && !selectedTagId) {
      toast.error("Selecione uma tag");
      return;
    }
    if (descriptionRequired && !description.trim()) {
      toast.error("Informe a descrição do pagamento");
      return;
    }
    startProbe();
  };

  const startProbe = async () => {
    setStep(3);
    setProbeError("");
    setBeneficiaryName(null);
    setBeneficiaryDocument(null);

    const result = await payByKey({
      pix_key: pixKey.trim(),
      valor: 0.01,
      descricao: "Verificação de beneficiário",
    });

    if (!result?.transaction_id) {
      setProbeError("Não foi possível verificar o beneficiário. Tente novamente.");
      return;
    }

    setProbeTransactionId(result.transaction_id);
    pollProbe(result.transaction_id);
  };

  const pollProbe = (txId: string) => {
    let attempts = 0;
    const maxAttempts = 90;

    const doPoll = async () => {
      if (!probeMountedRef.current) return;
      attempts++;

      try {
        const statusResult = await checkStatus(txId, true);
        if (!probeMountedRef.current) return;

        if (statusResult?.is_completed || statusResult?.internal_status === "completed") {
          stopProbePolling();
          let bene: { name: string | null; document: string | null } | null = null;
          for (let retry = 0; retry < 5; retry++) {
            bene = await getTransactionBeneficiary(txId);
            if (bene?.name) break;
            await new Promise(r => setTimeout(r, 1000));
          }
          if (probeMountedRef.current) {
            setBeneficiaryName(bene?.name || null);
            setBeneficiaryDocument(bene?.document || null);
            setStep(4);
          }
          return;
        }

        if (statusResult?.internal_status === "failed") {
          stopProbePolling();
          if (probeMountedRef.current) {
            setProbeError(statusResult.error_code || "A verificação falhou. Tente novamente.");
          }
          return;
        }

        if (attempts >= maxAttempts) {
          stopProbePolling();
          if (probeMountedRef.current) {
            setProbeError("Tempo esgotado aguardando confirmação da verificação.");
          }
        }
      } catch {
        if (attempts >= maxAttempts && probeMountedRef.current) {
          stopProbePolling();
          setProbeError("Erro ao verificar status da transação de verificação.");
        }
      }
    };

    doPoll();
    probePollingRef.current = setInterval(doPoll, 2000);
  };

  const handleConfirmRealPayment = async () => {
    setStep(5);
    const value = parseLocalizedNumber(amount);
    const fullDescription = orderNumber.trim()
      ? `${description.trim()} #${orderNumber.trim()}`
      : description.trim();

    const result = await payByKey({
      pix_key: pixKey.trim(),
      valor: value,
      descricao: fullDescription || undefined,
      receipt_required: selectedTagId ? false : true,
    });

    if (result?.transaction_id) {
      setRealTransactionId(result.transaction_id);
      if (!receiptRequired) {
        try {
          await supabase
            .from("transactions")
            .update({ receipt_required: false } as any)
            .eq("id", result.transaction_id);
        } catch (e) {
          console.error("[PixKeyDialog] Failed to update receipt_required:", e);
        }
      }
      setStep(6);
    } else {
      setStep(4);
    }
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const stepIcons = [Key, DollarSign, ShieldCheck, UserCheck, CreditCard, CheckCircle2];
  const stepTitles = [
    "Pix com Chave",
    "Valor do Pagamento",
    "Verificando Beneficiário",
    "Confirmar Beneficiário",
    "Processando Pagamento",
    "Status do Pagamento",
  ];
  const StepIcon = stepIcons[step - 1];
  const stepTitle = stepTitles[step - 1];

  if (!open) return null;

  // ── Step 1: Fullscreen transfer screen ──
  if (step === 1) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col h-dvh overflow-hidden">
        {/* Top bar with close button */}
        <div className="shrink-0 flex items-center justify-between px-5 pt-4 pb-2">
          <button
            onClick={handleClose}
            className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-muted transition-colors"
          >
            <X className="h-6 w-6 text-foreground" />
          </button>
        </div>

        {/* Content area - scrollable */}
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          {/* Title */}
          <div className="mt-4 mb-6">
            <h1 className="text-2xl font-bold text-foreground leading-tight">
              Para quem você quer{"\n"}transferir?
            </h1>
            <p className="text-sm text-green-500 mt-2">
              Insira o dado de quem vai receber
            </p>
          </div>

          {/* Search input with underline style */}
          <div className="relative mb-8">
            <div className="flex items-center border-b border-muted-foreground/30 pb-2 gap-3">
              <Search className="h-5 w-5 text-muted-foreground shrink-0" />
              <input
                type="text"
                placeholder="Nome, CPF/CNPJ ou chave Pix"
                value={pixKey}
                onChange={(e) => {
                  setPixKey(e.target.value);
                  setKeyError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleStep1Submit();
                }}
                className="flex-1 bg-transparent border-none outline-none text-base text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                className="h-8 w-8 flex items-center justify-center rounded-full bg-muted shrink-0"
                onClick={() => {
                  // QR code action placeholder
                  toast.info("Scanner QR em breve");
                }}
              >
                <QrCode className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
            {keyError && (
              <p className="text-xs text-destructive mt-1">{keyError}</p>
            )}
          </div>

          {/* Favorites section */}
          <div className="mb-8">
            <p className="text-sm font-semibold text-foreground mb-4">
              Você sempre costuma pagar
            </p>
            <div className="flex gap-5 overflow-x-auto pb-2">
              {MOCK_FAVORITES.map((fav) => (
                <button
                  key={fav.id}
                  type="button"
                  onClick={() => {
                    // In the future, fill the key from favorite data
                    toast.info(`Favorito: ${fav.name}`);
                  }}
                  className="flex flex-col items-center gap-2 min-w-[64px]"
                >
                  <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                    <span className="text-sm font-bold text-muted-foreground">{fav.initials}</span>
                  </div>
                  <span className="text-xs text-foreground font-medium text-center leading-tight max-w-[72px] truncate">
                    {fav.name}
                  </span>
                  <span className="text-[10px] text-muted-foreground -mt-1 truncate max-w-[72px]">
                    {fav.institution}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* All contacts section - placeholder */}
          <div>
            <p className="text-sm font-semibold text-foreground mb-3">
              Todos os seus contatos
            </p>
            <p className="text-xs text-muted-foreground">
              Em breve você poderá buscar seus contatos aqui.
            </p>
          </div>
        </div>

        {/* Bottom action - only show when there's a valid key typed */}
        {pixKey.trim().length > 0 && (
          <div className="shrink-0 px-5 pb-6 pt-3 border-t border-border">
            <Button
              onClick={handleStep1Submit}
              className="w-full h-12 text-base font-bold uppercase tracking-wider"
            >
              Continuar
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── Steps 2-6: Drawer ──
  const showHeader = step !== 6;

  return (
    <Drawer open={true} onOpenChange={step >= 3 && step <= 5 ? undefined : handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
          {showHeader && (
            <>
              <DrawerHeader className="flex-row items-center gap-3 p-0 pb-5">
                <button onClick={handleBack} className="p-1 -ml-1" disabled={step === 3 || step === 5}>
                  <ArrowLeft className={`h-5 w-5 ${step === 3 || step === 5 ? "opacity-30" : ""}`} />
                </button>
                <div className="flex items-center gap-2">
                  <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
                    <StepIcon className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <DrawerTitle className="text-base font-bold uppercase tracking-wide">
                    {stepTitle}
                  </DrawerTitle>
                </div>
              </DrawerHeader>
              <DrawerDescription className="sr-only">
                {stepTitle}
              </DrawerDescription>

              <div className="flex gap-1.5 mb-5">
                {Array.from({ length: 6 }, (_, i) => i + 1).map((s) => (
                  <div
                    key={s}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      s <= step ? "bg-primary" : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </>
          )}

          {/* Step 2: Amount + Description */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="rounded-lg bg-secondary/50 p-3 flex items-center gap-3">
                <Key className="h-4 w-4 text-primary shrink-0" />
                <p className="text-sm font-medium truncate">{pixKey}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pix-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Valor (R$)
                </Label>
                <Input
                  id="pix-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-14 text-2xl font-bold text-center"
                  data-vaul-no-drag
                  onFocus={(e) => {
                    const el = e.target;
                    setTimeout(() => {
                      el.scrollIntoView({ block: "center", behavior: "smooth" });
                    }, 400);
                  }}
                />
              </div>

              {/* Quick Tags */}
              {quickTags.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Tags Rápidas
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {quickTags.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          if (selectedTagId === tag.id) {
                            setSelectedTagId(null);
                            setSuggestedClassification(null);
                            setShowOrderInput(false);
                            setReceiptRequired(true);
                            setDescriptionPlaceholder("Ex: Pagamento fornecedor");
                            setDescriptionRequired(true);
                          } else {
                            setSelectedTagId(tag.id);
                            setSuggestedClassification(tag.suggested_classification || null);
                            setShowOrderInput(tag.request_order_number);
                            setReceiptRequired(false);
                            setDescriptionPlaceholder(tag.description_placeholder || "Ex: Pagamento fornecedor");
                            setDescriptionRequired(tag.description_required);
                          }
                        }}
                        className={`h-10 px-4 rounded-full font-medium text-sm border active:scale-95 transition-all ${
                          selectedTagId === tag.id
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                        }`}
                        data-vaul-no-drag
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Order Number Input */}
              {showOrderInput && (
                <div className="space-y-2">
                  <Label htmlFor="order-number" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Nº do Pedido
                  </Label>
                  <Input
                    id="order-number"
                    type="text"
                    inputMode="numeric"
                    placeholder="Ex: 1234"
                    value={orderNumber}
                    onChange={(e) => setOrderNumber(e.target.value)}
                    className="h-12 text-base"
                    data-vaul-no-drag
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="pix-description" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Descrição {descriptionRequired ? "*" : "(opcional)"}
                </Label>
                <Textarea
                  id="pix-description"
                  placeholder={descriptionPlaceholder}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 140))}
                  className="text-sm resize-none"
                  rows={2}
                  maxLength={140}
                  data-vaul-no-drag
                  onFocus={(e) => {
                    const el = e.target;
                    setTimeout(() => {
                      el.scrollIntoView({ block: "center", behavior: "smooth" });
                    }, 400);
                  }}
                />
                <p className="text-xs text-muted-foreground text-right">{description.length}/140</p>
              </div>

              <Button
                onClick={handleStep2}
                disabled={!amount || parseLocalizedNumber(amount) <= 0 || (descriptionRequired && !description.trim())}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 3: Verifying beneficiary (probe R$0.01) */}
          {step === 3 && (
            <div className="flex flex-col items-center gap-4 py-6">
              {probeError ? (
                <>
                  <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
                    <ShieldCheck className="h-8 w-8 text-destructive" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-bold">Falha na verificação</p>
                    <p className="text-sm text-muted-foreground">{probeError}</p>
                  </div>
                  <Button
                    onClick={() => { setProbeError(""); startProbe(); }}
                    className="w-full h-12 text-base font-bold uppercase tracking-wider"
                  >
                    Tentar Novamente
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleClose}
                    className="w-full h-11 text-sm font-bold uppercase tracking-wider"
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-bold">Consultando transação ...</p>
                    <p className="text-sm text-muted-foreground">
                      Aguarde enquanto consultamos os dados da transação.
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 4: Confirm beneficiary */}
          {step === 4 && (
            <div className="flex flex-col items-center gap-5 py-4">
              <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                <UserCheck className="h-9 w-9 text-primary" />
              </div>

              <div className="text-center space-y-2">
                <p className="text-sm text-muted-foreground">O beneficiário desta chave é:</p>
                <p className="text-xl font-bold">{beneficiaryName || "Não identificado"}</p>
              </div>

              <div className="text-center space-y-1">
                <p className="text-sm text-muted-foreground">Deseja prosseguir com o pagamento de</p>
                <p className="text-2xl font-bold text-primary">{formattedAmount()}</p>
              </div>

              <div className="w-full space-y-2 mt-2">
                <Button
                  onClick={handleConfirmRealPayment}
                  disabled={isProcessing}
                  className="w-full h-12 text-base font-bold uppercase tracking-wider"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      Processando...
                    </>
                  ) : (
                    "Confirmar e Pagar"
                  )}
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleClose}
                  className="w-full h-11 text-sm font-bold uppercase tracking-wider"
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Processing real payment */}
          {step === 5 && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-base font-bold">Enviando pagamento</p>
                <p className="text-sm text-muted-foreground">
                  Processando {formattedAmount()} para {beneficiaryName || pixKey}...
                </p>
              </div>
            </div>
          )}

          {/* Step 6: Status verification of real payment */}
          {step === 6 && realTransactionId && (
            <PaymentStatusScreen
              transactionId={realTransactionId}
              amount={parseLocalizedNumber(amount)}
              beneficiaryName={beneficiaryName || pixKey}
              onClose={handleCloseAndNavigate}
              redirectToReceiptCapture={receiptRequired}
              skipReceiptCapture={!receiptRequired}
            />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
