import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Key, DollarSign, CheckCircle2, Search, UserCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { usePixPayment } from "@/hooks/usePixPayment";
import { parseLocalizedNumber, isValidPaymentAmount } from "@/lib/utils";

interface DictInfo {
  name: string;
  cpf_cnpj: string;
  key_type: string;
  key: string;
  bank_name: string;
  agency: string;
  account: string;
  account_type: string;
  end2end_id: string;
  ispb: string;
}

interface PixKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function maskDocument(doc: string): string {
  if (!doc) return '';
  const clean = doc.replace(/\D/g, '');
  if (clean.length === 11) {
    return `${clean.substring(0, 3)}.***.*${clean.substring(8, 9)}*-${clean.substring(9)}`;
  }
  if (clean.length === 14) {
    return `${clean.substring(0, 2)}.***.***/****-${clean.substring(12)}`;
  }
  return doc;
}

export function PixKeyDialog({ open, onOpenChange }: PixKeyDialogProps) {
  const navigate = useNavigate();
  const { payByKey, lookupKey, isProcessing, isLookingUp } = usePixPayment();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [pixKey, setPixKey] = useState("");
  const [amount, setAmount] = useState("");
  const [saveFavorite, setSaveFavorite] = useState(false);
  const [dictInfo, setDictInfo] = useState<DictInfo | null>(null);

  const handleClose = () => {
    setPixKey("");
    setAmount("");
    setSaveFavorite(false);
    setStep(1);
    setDictInfo(null);
    onOpenChange(false);
  };

  const handleBack = () => {
    if (step === 1) {
      handleClose();
    } else {
      setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
    }
  };

  // Step 1 → lookup DICT → Step 2 (show recipient)
  const handleStep1 = async () => {
    const trimmed = pixKey.trim();
    if (!trimmed) {
      toast.error("Informe a chave Pix");
      return;
    }

    const result = await lookupKey(trimmed);
    if (result) {
      setDictInfo(result as DictInfo);
      setStep(2);
    }
    // If lookup fails, stay on step 1 (toast already shown by hook)
  };

  // Step 2 → confirm recipient → Step 3 (amount)
  const handleStep2 = () => {
    setStep(3);
  };

  // Step 3 → validate amount → Step 4 (confirm)
  const handleStep3 = () => {
    const value = parseLocalizedNumber(amount);
    const validation = isValidPaymentAmount(value);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    setStep(4);
  };

  const handleConfirm = async () => {
    const value = parseLocalizedNumber(amount);
    const result = await payByKey({
      pix_key: pixKey.trim(),
      valor: value,
    });

    if (result) {
      handleClose();
      navigate(`/transactions`);
    }
  };

  const formattedAmount = () => {
    const value = parseLocalizedNumber(amount);
    if (isNaN(value)) return "R$ 0,00";
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const stepIcons = [Key, UserCheck, DollarSign, CheckCircle2];
  const stepTitles = ["Pix com Chave", "Confirmar Destinatário", "Valor do Pagamento", "Confirmar Pagamento"];
  const totalSteps = 4;
  const StepIcon = stepIcons[step - 1];
  const stepTitle = stepTitles[step - 1];

  return (
    <Drawer open={open} onOpenChange={handleClose}>
      <DrawerContent>
        <div className="px-5 pb-8">
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
            {Array.from({ length: totalSteps }, (_, i) => i + 1).map((s) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* Step 1: Pix Key */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="pix-key" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Chave Pix
                </Label>
                <Input
                  id="pix-key"
                  placeholder="Ex: 123.456.789-10"
                  value={pixKey}
                  onChange={(e) => setPixKey(e.target.value)}
                  className="h-12 text-base"
                  autoFocus
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="save-favorite"
                  checked={saveFavorite}
                  onCheckedChange={(checked) => setSaveFavorite(checked === true)}
                />
                <Label htmlFor="save-favorite" className="text-sm font-medium cursor-pointer">
                  Salvar como Favorecido
                </Label>
              </div>

              <Button
                onClick={handleStep1}
                disabled={!pixKey.trim() || isLookingUp}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                {isLookingUp ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Consultando DICT...
                  </>
                ) : (
                  <>
                    <Search className="h-5 w-5 mr-2" />
                    Consultar Chave
                  </>
                )}
              </Button>
            </div>
          )}

          {/* Step 2: Confirm Recipient (DICT result) */}
          {step === 2 && dictInfo && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <UserCheck className="h-5 w-5 text-primary" />
                  <p className="text-sm font-bold text-primary">Destinatário Identificado</p>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nome</p>
                  <p className="text-sm font-semibold mt-1">{dictInfo.name || '—'}</p>
                </div>

                <div className="h-px bg-border" />

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">CPF/CNPJ</p>
                  <p className="text-sm font-medium mt-1">{maskDocument(dictInfo.cpf_cnpj)}</p>
                </div>

                <div className="h-px bg-border" />

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Banco</p>
                    <p className="text-xs font-medium mt-1">{dictInfo.bank_name || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tipo da Chave</p>
                    <p className="text-xs font-medium mt-1">{dictInfo.key_type || '—'}</p>
                  </div>
                </div>

                {(dictInfo.agency || dictInfo.account) && (
                  <>
                    <div className="h-px bg-border" />
                    <div className="grid grid-cols-2 gap-3">
                      {dictInfo.agency && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Agência</p>
                          <p className="text-xs font-medium mt-1">{dictInfo.agency}</p>
                        </div>
                      )}
                      {dictInfo.account && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Conta</p>
                          <p className="text-xs font-medium mt-1">{dictInfo.account}</p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-start gap-2 p-3 rounded-lg bg-accent/50 text-xs text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-accent-foreground shrink-0 mt-0.5" />
                <p>Confirme se os dados acima correspondem ao destinatário correto antes de prosseguir.</p>
              </div>

              <Button
                onClick={handleStep2}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Confirmar Destinatário
              </Button>
            </div>
          )}

          {/* Step 3: Amount */}
          {step === 3 && (
            <div className="space-y-5">
              {dictInfo && (
                <div className="rounded-lg bg-secondary/50 p-3 flex items-center gap-3">
                  <UserCheck className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{dictInfo.name}</p>
                    <p className="text-xs text-muted-foreground">{maskDocument(dictInfo.cpf_cnpj)}</p>
                  </div>
                </div>
              )}

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
                  autoFocus
                />
              </div>

              <Button
                onClick={handleStep3}
                disabled={!amount || parseLocalizedNumber(amount) <= 0}
                className="w-full h-12 text-base font-bold uppercase tracking-wider"
              >
                Continuar
              </Button>
            </div>
          )}

          {/* Step 4: Confirmation */}
          {step === 4 && (
            <div className="space-y-5">
              <div className="rounded-xl bg-secondary p-4 space-y-3">
                {dictInfo && (
                  <>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Destinatário</p>
                      <p className="text-sm font-semibold mt-1">{dictInfo.name}</p>
                      <p className="text-xs text-muted-foreground">{maskDocument(dictInfo.cpf_cnpj)} • {dictInfo.bank_name}</p>
                    </div>
                    <div className="h-px bg-border" />
                  </>
                )}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Chave Pix</p>
                  <p className="text-sm font-medium break-all mt-1">{pixKey}</p>
                </div>
                <div className="h-px bg-border" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Valor</p>
                  <p className="text-lg font-bold text-primary mt-1">{formattedAmount()}</p>
                </div>
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
        </div>
      </DrawerContent>
    </Drawer>
  );
}
