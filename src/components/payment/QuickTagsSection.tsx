import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { QuickTag } from "@/hooks/useQuickTags";

interface QuickTagsSectionProps {
  tags: QuickTag[];
  selectedTagId: string | null;
  onSelectTag: (tag: QuickTag | null) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  descriptionPlaceholder: string;
  descriptionRequired: boolean;
  orderNumber: string;
  onOrderNumberChange: (value: string) => void;
  showOrderInput: boolean;
  maxDescriptionLength?: number;
}

export function QuickTagsSection({
  tags,
  selectedTagId,
  onSelectTag,
  description,
  onDescriptionChange,
  descriptionPlaceholder,
  descriptionRequired,
  orderNumber,
  onOrderNumberChange,
  showOrderInput,
  maxDescriptionLength = 140,
}: QuickTagsSectionProps) {
  if (tags.length === 0) {
    return (
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Descrição *
        </Label>
        <Textarea
          placeholder="Ex: Pagamento fornecedor"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value.slice(0, maxDescriptionLength))}
          className="min-h-[60px] text-sm resize-none"
          data-vaul-no-drag
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Tag chips */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Tags Rápidas
        </Label>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => {
                if (selectedTagId === tag.id) {
                  onSelectTag(null);
                } else {
                  onSelectTag(tag);
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

      {/* Order number */}
      {showOrderInput && (
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Nº do Pedido
          </Label>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="Ex: 1234"
            value={orderNumber}
            onChange={(e) => onOrderNumberChange(e.target.value)}
            className="h-12 text-base"
            data-vaul-no-drag
          />
        </div>
      )}

      {/* Description */}
      <div className="space-y-2">
        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Descrição {descriptionRequired ? "*" : "(opcional)"}
        </Label>
        <Textarea
          placeholder={descriptionPlaceholder}
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value.slice(0, maxDescriptionLength))}
          className="text-sm resize-none"
          rows={2}
          maxLength={maxDescriptionLength}
          data-vaul-no-drag
        />
        <p className="text-xs text-muted-foreground text-right">{description.length}/{maxDescriptionLength}</p>
      </div>
    </div>
  );
}
