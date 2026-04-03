import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Banknote } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { invalidateDashboardCache } from "@/hooks/useDashboardData";
import { useQuickTags, QuickTag } from "@/hooks/useQuickTags";
import { QuickTagsSection } from "@/components/payment/QuickTagsSection";
import { toast } from "sonner";

interface CashPaymentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CashPaymentDrawer({ open, onOpenChange }: CashPaymentDrawerProps) {
  const [amount, setAmount] = useState("");
  const [beneficiary, setBeneficiary] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [showOrderInput, setShowOrderInput] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [descriptionPlaceholder, setDescriptionPlaceholder] = useState("Observações do pagamento...");
  const [descriptionRequired, setDescriptionRequired] = useState(false);
  const navigate = useNavigate();
  const { toast: toastHook } = useToast();
  const { currentCompany, user } = useAuth();
  const { tags: quickTags } = useQuickTags("cash");

  const handleTagSelect = (tag: QuickTag | null) => {
    if (!tag) {
      setSelectedTagId(null);
      setShowOrderInput(false);
      setDescriptionPlaceholder("Observações do pagamento...");
      setDescriptionRequired(false);
    } else {
      setSelectedTagId(tag.id);
      setShowOrderInput(tag.request_order_number);
      setDescriptionPlaceholder(tag.description_placeholder || "Observações do pagamento...");
      setDescriptionRequired(tag.description_required);
    }
  };

  const handleSubmit = async () => {
    const parsedAmount = parseFloat(amount.replace(",", "."));
    if (!parsedAmount || parsedAmount <= 0) {
      toastHook({ variant: "destructive", title: "Erro", description: "Informe um valor válido." });
      return;
    }
    if (!beneficiary.trim()) {
      toastHook({ variant: "destructive", title: "Erro", description: "Informe o nome do favorecido." });
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
    if (!currentCompany?.id || !user?.id) {
      toastHook({ variant: "destructive", title: "Erro", description: "Empresa ou usuário não identificado." });
      return;
    }

    setIsLoading(true);
    try {
      const fullDescription = orderNumber.trim()
        ? `${(description.trim() || "Pagamento em dinheiro")} #${orderNumber.trim()}`
        : description.trim() || "Pagamento em dinheiro";

      const selectedTag = quickTags.find(t => t.id === selectedTagId);
      const { data, error } = await supabase.from("transactions").insert({
        company_id: currentCompany.id,
        created_by: user.id,
        amount: parsedAmount,
        beneficiary_name: beneficiary.trim(),
        description: fullDescription,
        pix_type: "cash" as any,
        status: "completed",
        paid_at: new Date().toISOString(),
        quick_tag_name: selectedTag?.name || null,
      } as any).select("id").single();

      if (error) throw error;

      invalidateDashboardCache();
      toastHook({ title: "Pagamento registrado!", description: "Agora anexe o comprovante." });
      onOpenChange(false);
      setAmount("");
      setBeneficiary("");
      setDescription("");
      setOrderNumber("");
      setShowOrderInput(false);
      setSelectedTagId(null);
      setDescriptionPlaceholder("Observações do pagamento...");
      setDescriptionRequired(false);
      navigate(`/pix/receipt/${data.id}`);
    } catch (error: any) {
      console.error("[CashPaymentDrawer] Error:", error);
      toastHook({ variant: "destructive", title: "Erro", description: error.message || "Falha ao registrar pagamento." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-4 pb-8">
        <DrawerHeader className="text-left px-0">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Banknote className="h-5 w-5 text-primary" />
            </div>
            <DrawerTitle>Registrar Pagamento em Dinheiro</DrawerTitle>
          </div>
        </DrawerHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="cash-amount">Valor (R$) *</Label>
            <Input
              id="cash-amount"
              placeholder="0,00"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="text-lg font-mono-numbers"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cash-beneficiary">Favorecido *</Label>
            <Input
              id="cash-beneficiary"
              placeholder="Nome de quem recebeu o dinheiro"
              value={beneficiary}
              onChange={(e) => setBeneficiary(e.target.value)}
            />
          </div>

          {/* Quick Tags + Description */}
          <QuickTagsSection
            tags={quickTags}
            selectedTagId={selectedTagId}
            onSelectTag={handleTagSelect}
            description={description}
            onDescriptionChange={setDescription}
            descriptionPlaceholder={descriptionPlaceholder}
            descriptionRequired={descriptionRequired}
            orderNumber={orderNumber}
            onOrderNumberChange={setOrderNumber}
            showOrderInput={showOrderInput}
          />

          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            className="w-full h-12 text-base font-bold uppercase tracking-wider"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Registrando...
              </>
            ) : (
              "Registrar Pagamento"
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
