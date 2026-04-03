import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, DollarSign, CheckCircle2, AlertTriangle, XCircle, Clock, Home } from "lucide-react";
import { invalidateDashboardCache } from "@/hooks/useDashboardData";
import { toast } from "sonner";
import { useBilletPayment, BilletConsultResult } from "@/hooks/useBilletPayment";
import { supabase } from "@/integrations/supabase/client";
import { parseBoleto } from "@/utils/boletoParser";
import { parseLocalizedNumber, isValidPaymentAmount } from "@/lib/utils";
import { useQuickTags, QuickTag } from "@/hooks/useQuickTags";
import { QuickTagsSection } from "@/components/payment/QuickTagsSection";

interface BoletoPaymentDrawerProps {
  open: boolean;
  barcode: string;
  onOpenChange: (open: boolean) => void;
}

type StatusState = "polling" | "completed" | "failed" | "timeout";

export function BoletoPaymentDrawer({ open, barcode, onOpenChange }: BoletoPaymentDrawerProps) {
  const navigate = useNavigate();
  const { payBillet, isProcessing, consultBillet } = useBilletPayment();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [consultInfo, setConsultInfo] = useState<BilletConsultResult | null>(null);
  const [transactionId, setTransactionId] = useState("");

  // Status polling state
  const [statusState, setStatusState] = useState<StatusState>("polling");
  const [errorMessage, setErrorMessage] = useState("");
  const pollTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const pollAttemptsRef = React.useRef(0);
  const mountedRef = React.useRef(true);

  const MAX_POLL_ATTEMPTS = 60; // boletos can take longer
  const POLL_INTERVAL = 3000;

  useEffect(() => {
    if (!open || !barcode) return;
    setDescription("");
    setCompanyName("");
    setConsultInfo(null);
    setTransactionId("");
    setStatusState("polling");
    setErrorMessage("");
    pollAttemptsRef.current = 0;

    const info = parseBoleto(barcode);
    if (info && info.amount > 0) {
      setAmount(info.amount.toFixed(2).replace(".", ","));
      setDueDate(info.dueDate);
    } else {
      setAmount("");
      setDueDate(null);
    }
    setStep(1);

    consultBillet(barcode).then((result) => {
      if (result) {
        setConsultInfo(result);
        if (result.recipient_name) setCompanyName(result.recipient_name);
        if (result.total_updated_value && result.total_updated_value > 0) {
          setAmount(result.total_updated_value.toFixed(2).replace(".", ","));
        } else if (result.value && result.value > 0) {
          setAmount(result.value.toFixed(2).replace(".", ","));
        }
        if (result.due_date) {
          setDueDate(result.due_date);
        }
        // Auto-advance to step 2 if we have a value (from API or local parser)
        if ((result.total_updated_value && result.total_updated_value > 0) || (result.value && result.value > 0)) {
          setStep(2);
        }
      } else {
        if (info && info.amount > 0) {
          setStep(2);
        }
      }
    });
  }, [open, barcode]);

  // Cleanup polling on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const startPolling = (txId: string) => {
    pollAttemptsRef.current = 0;
    setStatusState("polling");
    setErrorMessage("");

    const poll = async () => {
      if (!mountedRef.current) return;
      pollAttemptsRef.current++;

      try {
        const { data: result, error } = await supabase.functions.invoke('pix-check-status', {
          body: { transaction_id: txId },
        });
        if (!mountedRef.current) return;

        if (error || !result) {
          if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
            setStatusState("timeout");
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          }
          return;
        }

        if (result.is_completed || result.internal_status === "completed") {
          setStatusState("completed");
          invalidateDashboardCache();
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          return;
        }

        if (result.internal_status === "failed") {
          setStatusState("failed");
          setErrorMessage(result.error_code || result.error || "O pagamento do boleto foi recusado.");
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          return;
        }

        if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS) {
          setStatusState("timeout");
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      } catch {
        if (pollAttemptsRef.current >= MAX_POLL_ATTEMPTS && mountedRef.current) {
          setStatusState("timeout");
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      }
    };

    poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL);
  };

  const handleClose = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    onOpenChange(false);
  };

  const handleBack = () => {
    if (step === 1) handleClose();
    else if (step === 3) return; // can't go back during status check
    else setStep(1);
  };

  const handleStep1 = () => {
    const value = parseLocalizedNumber(amount);
    const validation = isValidPaymentAmount(value);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    setStep(2);
  };

  const handleConfirm = async () => {
    if (!companyName.trim()) {
      toast.error("Informe o nome da empresa que está recebendo o pagamento");
      return;
    }
    const value = parseLocalizedNumber(amount);
    const result = await payBillet({
      digitable_code: barcode,
      description: description || "Pagamento de boleto",
      amount: value,
    });

    if (result) {
      invalidateDashboardCache();
      const txId = (result as any).transaction_id || (result as any).id;
      if (txId) {
        // Save beneficiary_name
        try {
          const { supabase } = await import("@/integrations/supabase/client");
          await supabase
            .from("transactions")
            .update({ beneficiary_name: companyName.trim() } as any)
            .eq("id", txId);
        } catch (e) {
          console.error("[BoletoPaymentDrawer] Failed to update beneficiary_name:", e);
        }
        setTransactionId(txId);
        setStep(3);
        startPolling(txId);
      } else {
        toast.error("Pagamento enviado, mas não foi possível rastrear o status.");
        handleClose();
        navigate("/transactions");
      }
    }
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const formattedDueDate = () => {
    if (!dueDate) return null;
    const [y, m, d] = dueDate.split("-");
    return `${d}/${m}/${y}`;
  };

  const formatCurrency = (val?: number) => {
    if (!val || val === 0) return null;
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const hasInterestOrFine = consultInfo && (
    (consultInfo.interest_value && consultInfo.interest_value > 0) ||
    (consultInfo.fine_value && consultInfo.fine_value > 0) ||
    (consultInfo.total_updated_value && consultInfo.value && consultInfo.total_updated_value > consultInfo.value)
  );
  const hasDiscount = consultInfo && consultInfo.discount_value && consultInfo.discount_value > 0;

  // Calculate charges when individual fine/interest aren't provided but total_updated_value differs from value
  const calculatedCharges = consultInfo?.total_updated_value && consultInfo?.value && consultInfo.total_updated_value > consultInfo.value
    ? Math.round((consultInfo.total_updated_value - consultInfo.value) * 100) / 100
    : 0;

  const stepIcon = step === 1 ? DollarSign : step === 2 ? CheckCircle2 : CheckCircle2;
  const stepTitle = step === 1 ? "Valor do Boleto" : step === 2 ? "Confirmar Pagamento" : "Verificando";
  const StepIcon = stepIcon;

  return (
    <Drawer open={open} onOpenChange={step === 3 ? undefined : handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
          {step !== 3 && (
            <>
              <DrawerHeader className="flex-row items-center gap-3 p-0 pb-5">
                <button onClick={handleBack} className="p-1 -ml-1">
                  <ArrowLeft className="h-5 w-5" />
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

              {/* Step indicators */}
              <div className="flex gap-1.5 mb-5">
                {[1, 2, 3].map((s) => (
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

          {/* Loading consult */}
          {step === 1 && consultInfo === null && (
            <div className="flex items-center gap-2 mb-4 p-3 rounded-xl bg-secondary text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando boleto na CIP...
            </div>
          )}

          {/* Step 1: Amount */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Código</p>
                <p className="text-xs font-mono break-all text-foreground/80">{barcode}</p>
              </div>

              {consultInfo && consultInfo.recipient_name && (
                <div className="rounded-xl bg-secondary p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">Beneficiário</p>
                  <p className="text-sm font-medium">{consultInfo.recipient_name}</p>
                  {consultInfo.recipient_document && (
                    <p className="text-xs text-muted-foreground mt-0.5">{consultInfo.recipient_document}</p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="boleto-amount" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Valor (R$)
                </Label>
                <Input
                  id="boleto-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-14 text-2xl font-bold text-center"
                  autoFocus
                />
              </div>

              <Button
                onClick={handleStep1}
                disabled={!amount || parseLocalizedNumber(amount) <= 0}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 2: Confirmation */}
          {step === 2 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-4 space-y-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tipo</p>
                  <p className="text-sm font-medium mt-1">Boleto</p>
                </div>
                <div className="h-px bg-border" />

                {consultInfo?.recipient_name && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Beneficiário</p>
                      <p className="text-sm font-medium mt-1">{consultInfo.recipient_name}</p>
                      {consultInfo.recipient_document && (
                        <p className="text-xs text-muted-foreground">{consultInfo.recipient_document}</p>
                      )}
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Código</p>
                  <p className="text-xs font-mono break-all mt-1">{barcode}</p>
                </div>
                <div className="h-px bg-border" />
                {formattedDueDate() && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Vencimento</p>
                      <p className="text-sm font-medium mt-1">{formattedDueDate()}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}

                {consultInfo?.value && hasInterestOrFine && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Valor Original</p>
                      <p className="text-sm font-medium mt-1">{formatCurrency(consultInfo.value)}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}

                {consultInfo?.fine_value && consultInfo.fine_value > 0 && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Multa</p>
                    </div>
                    <p className="text-sm font-medium text-amber-600 -mt-2">+ {formatCurrency(consultInfo.fine_value)}</p>
                    <div className="h-px bg-border" />
                  </>
                )}

                {consultInfo?.interest_value && consultInfo.interest_value > 0 && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Juros</p>
                    </div>
                    <p className="text-sm font-medium text-amber-600 -mt-2">+ {formatCurrency(consultInfo.interest_value)}</p>
                    <div className="h-px bg-border" />
                  </>
                )}

                {/* When we have total_updated_value but no individual fine/interest breakdown */}
                {calculatedCharges > 0 && !consultInfo?.fine_value && !consultInfo?.interest_value && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-600">Juros/Multa</p>
                    </div>
                    <p className="text-sm font-medium text-amber-600 -mt-2">+ {formatCurrency(calculatedCharges)}</p>
                    <div className="h-px bg-border" />
                  </>
                )}

                {hasDiscount && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Desconto</p>
                      <p className="text-sm font-medium text-emerald-600 mt-1">- {formatCurrency(consultInfo!.discount_value)}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    {hasInterestOrFine ? "Valor Atualizado" : "Valor"}
                  </p>
                  <p className="text-lg font-bold text-primary mt-1">{formattedAmount()}</p>
                </div>
              </div>

              {hasInterestOrFine && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Este boleto possui juros e/ou multa por atraso. O valor atualizado já inclui esses encargos.
                  </p>
                </div>
              )}

              {/* ONZ overdue boleto warning - only if we couldn't get adjusted amount */}
              {consultInfo && consultInfo.is_overdue && !hasInterestOrFine && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Boleto vencido. Não foi possível obter o valor atualizado. O valor final poderá incluir juros e multa.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="boleto-company" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Nome da Empresa *
                </Label>
                <Input
                  id="boleto-company"
                  type="text"
                  placeholder="Ex: Empresa XYZ Ltda"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="boleto-desc" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Descrição (opcional)
                </Label>
                <Input
                  id="boleto-desc"
                  type="text"
                  placeholder="Ex: Conta de luz"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <Button
                onClick={handleConfirm}
                disabled={isProcessing}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Processando...
                  </>
                ) : (
                  "Confirmar Pagamento"
                )}
              </Button>
            </div>
          )}

          {/* Step 3: Status verification */}
          {step === 3 && (
            <div className="flex flex-col items-center gap-4 py-3 pb-[env(safe-area-inset-bottom,16px)]">
              {statusState === "polling" && (
                <>
                  <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-bold">Aguardando confirmação</p>
                    <p className="text-sm text-muted-foreground">
                      Verificando status do boleto...
                    </p>
                  </div>
                  <p className="text-xl font-bold text-primary">{formattedAmount()}</p>
                </>
              )}

              {statusState === "completed" && (
                <>
                  <div className="h-14 w-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-bold">Boleto pago com sucesso!</p>
                    <p className="text-sm text-muted-foreground">
                      O pagamento foi confirmado.
                    </p>
                  </div>
                  <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{formattedAmount()}</p>
                  <div className="w-full space-y-2 mt-1">
                    <Button
                      onClick={() => {
                        handleClose();
                        navigate(`/pix/receipt/${transactionId}`);
                      }}
                      className="w-full h-11 text-sm font-bold uppercase tracking-wider"
                    >
                      Anexar Comprovante
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => { handleClose(); navigate("/"); }}
                      className="w-full h-11 text-sm font-bold uppercase tracking-wider"
                    >
                      <Home className="mr-2 h-5 w-5" />
                      Voltar ao Início
                    </Button>
                  </div>
                </>
              )}

              {statusState === "failed" && (
                <>
                  <div className="h-14 w-14 rounded-full bg-destructive/10 flex items-center justify-center">
                    <XCircle className="h-8 w-8 text-destructive" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-bold">Pagamento não concluído</p>
                    <p className="text-sm text-muted-foreground">{errorMessage}</p>
                  </div>
                  <p className="text-xl font-bold text-destructive">{formattedAmount()}</p>
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    className="w-full h-11 text-sm font-bold uppercase tracking-wider mt-1"
                  >
                    Fechar
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => { handleClose(); navigate("/"); }}
                    className="w-full h-11 text-sm font-bold uppercase tracking-wider"
                  >
                    <Home className="mr-2 h-5 w-5" />
                    Voltar ao Início
                  </Button>
                </>
              )}

              {statusState === "timeout" && (
                <>
                  <div className="h-14 w-14 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <Clock className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="text-center space-y-1">
                    <p className="text-base font-bold">Boleto em processamento</p>
                    <p className="text-sm text-muted-foreground">
                      O pagamento ainda está sendo processado. Acompanhe pelo extrato.
                    </p>
                  </div>
                  <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{formattedAmount()}</p>
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    className="w-full h-11 text-sm font-bold uppercase tracking-wider mt-1"
                  >
                    Fechar
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => { handleClose(); navigate("/"); }}
                    className="w-full h-11 text-sm font-bold uppercase tracking-wider"
                  >
                    <Home className="mr-2 h-5 w-5" />
                    Voltar ao Início
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
