import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useQuickTagsAdmin, QuickTag, PAYMENT_TYPE_OPTIONS } from "@/hooks/useQuickTags";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plus, Pencil, Trash2, Tag, Loader2, GripVertical } from "lucide-react";
import { toast } from "sonner";

export default function QuickTags() {
  const { tags, isLoading, createTag, updateTag, deleteTag } = useQuickTagsAdmin();
  const isMobile = useIsMobile();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<QuickTag | null>(null);
  const [formName, setFormName] = useState("");
  const [formClassification, setFormClassification] = useState<string>("none");
  const [formRequestOrder, setFormRequestOrder] = useState(false);
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [formPlaceholder, setFormPlaceholder] = useState("");
  const [formDescriptionRequired, setFormDescriptionRequired] = useState(true);
  const [formVisibleIn, setFormVisibleIn] = useState<string[]>(["key", "qrcode", "copy_paste", "boleto", "cash"]);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditingTag(null);
    setFormName("");
    setFormClassification("none");
    setFormRequestOrder(false);
    setFormSortOrder(tags.length);
    setFormPlaceholder("");
    setFormDescriptionRequired(true);
    setFormVisibleIn(["key", "qrcode", "copy_paste", "boleto", "cash"]);
    setDialogOpen(true);
  };

  const openEdit = (tag: QuickTag) => {
    setEditingTag(tag);
    setFormName(tag.name);
    setFormClassification(tag.suggested_classification || "none");
    setFormRequestOrder(tag.request_order_number);
    setFormSortOrder(tag.sort_order);
    setFormPlaceholder(tag.description_placeholder || "");
    setFormDescriptionRequired(tag.description_required);
    setFormVisibleIn(tag.visible_in || ["key", "qrcode", "copy_paste", "boleto", "cash"]);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formName.trim()) {
      toast.error("Nome é obrigatório");
      return;
    }
    setSaving(true);
    try {
      const classification = formClassification === "none" ? null : formClassification;
      const placeholder = formPlaceholder.trim() || null;
      if (editingTag) {
        await updateTag(editingTag.id, {
          name: formName.trim(),
          suggested_classification: classification,
          request_order_number: formRequestOrder,
          sort_order: formSortOrder,
          description_placeholder: placeholder,
          description_required: formDescriptionRequired,
          visible_in: formVisibleIn,
        });
        toast.success("Tag atualizada");
      } else {
        await createTag({
          name: formName.trim(),
          suggested_classification: classification,
          request_order_number: formRequestOrder,
          sort_order: formSortOrder,
          description_placeholder: placeholder,
          description_required: formDescriptionRequired,
          visible_in: formVisibleIn,
        });
        toast.success("Tag criada");
      }
      setDialogOpen(false);
    } catch {
      toast.error("Erro ao salvar tag");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (tag: QuickTag) => {
    if (!confirm(`Excluir a tag "${tag.name}"?`)) return;
    try {
      await deleteTag(tag.id);
      toast.success("Tag excluída");
    } catch {
      toast.error("Erro ao excluir");
    }
  };

  const handleToggleActive = async (tag: QuickTag) => {
    try {
      await updateTag(tag.id, { is_active: !tag.is_active });
      toast.success(tag.is_active ? "Tag desativada" : "Tag ativada");
    } catch {
      toast.error("Erro ao alterar status");
    }
  };

  const classificationLabel = (val: string | null) => {
    if (val === "cost") return "Custo (Insumo)";
    if (val === "expense") return "Despesa";
    return "Nenhuma";
  };

  const visibilityLabel = (val: string) => {
    const found = PAYMENT_TYPE_OPTIONS.find((o) => o.value === val);
    return found?.label || val;
  };

  const toggleVisibleIn = (value: string) => {
    setFormVisibleIn((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  };

  return (
    <MainLayout>
      <div className="p-4 lg:p-8 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Tags de Atalho</h1>
            <p className="text-sm text-muted-foreground">
              Gerencie as tags de preenchimento rápido para pagamentos
            </p>
          </div>
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            {!isMobile && "Nova Tag"}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Tag className="h-5 w-5" />
              Tags Cadastradas
            </CardTitle>
            <CardDescription>
              Os operadores verão estas tags como botões rápidos na tela de pagamento
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : tags.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Tag className="h-10 w-10 mx-auto mb-2 opacity-40" />
                <p>Nenhuma tag cadastrada</p>
                <p className="text-sm">Crie tags para agilizar o preenchimento dos pagamentos</p>
              </div>
            ) : isMobile ? (
              /* Mobile: Card list */
              <div className="space-y-3">
                {tags.map((tag) => (
                  <div
                    key={tag.id}
                    className="rounded-lg border bg-card p-4 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1 min-w-0">
                        <p className="font-medium truncate">{tag.name}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={tag.suggested_classification ? "default" : "secondary"} className="text-xs">
                            {classificationLabel(tag.suggested_classification)}
                          </Badge>
                           {tag.request_order_number && (
                            <Badge variant="outline" className="text-xs">Nº Pedido</Badge>
                          )}
                          {tag.visible_in && tag.visible_in.length < 5 && (
                            <Badge variant="outline" className="text-xs">
                              {tag.visible_in.map(visibilityLabel).join(", ")}
                            </Badge>
                          )}
                        </div>
                      </div>
                      <Switch
                        checked={tag.is_active}
                        onCheckedChange={() => handleToggleActive(tag)}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 min-h-[44px]"
                        onClick={() => openEdit(tag)}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px] text-destructive hover:text-destructive"
                        onClick={() => handleDelete(tag)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Desktop: Table */
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Nome</TableHead>
                      <TableHead>Classificação</TableHead>
                      <TableHead>Nº Pedido</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tags.map((tag) => (
                      <TableRow key={tag.id}>
                        <TableCell>
                          <GripVertical className="h-4 w-4 text-muted-foreground" />
                        </TableCell>
                        <TableCell className="font-medium">{tag.name}</TableCell>
                        <TableCell>
                          <Badge variant={tag.suggested_classification ? "default" : "secondary"}>
                            {classificationLabel(tag.suggested_classification)}
                          </Badge>
                        </TableCell>
                        <TableCell>{tag.request_order_number ? "Sim" : "Não"}</TableCell>
                        <TableCell>
                          <Switch
                            checked={tag.is_active}
                            onCheckedChange={() => handleToggleActive(tag)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(tag)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(tag)} className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create / Edit Dialog — Drawer on mobile */}
        <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editingTag ? "Editar Tag" : "Nova Tag"}</ResponsiveDialogTitle>
            </ResponsiveDialogHeader>
            <div className={`space-y-4 ${isMobile ? "px-4" : "py-2"}`}>
              <div className="space-y-2">
                <Label>Nome da Tag *</Label>
                <Input
                  placeholder="Ex: Troco Cliente, Pagamento Motoboy"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  data-vaul-no-drag
                />
              </div>

              <div className="space-y-2">
                <Label>Categoria Sugerida</Label>
                <Select value={formClassification} onValueChange={setFormClassification}>
                  <SelectTrigger data-vaul-no-drag>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma</SelectItem>
                    <SelectItem value="cost">Custo (Insumo)</SelectItem>
                    <SelectItem value="expense">Despesa</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Se definida, a classificação será pré-selecionada ao usar esta tag
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Checkbox
                  id="request-order"
                  checked={formRequestOrder}
                  onCheckedChange={(v) => setFormRequestOrder(v === true)}
                />
                <Label htmlFor="request-order" className="cursor-pointer">
                  Solicitar Nº do Pedido
                </Label>
              </div>


              <div className="flex items-center gap-3">
                <Checkbox
                  id="description-required"
                  checked={formDescriptionRequired}
                  onCheckedChange={(v) => setFormDescriptionRequired(v === true)}
                />
                <div>
                  <Label htmlFor="description-required" className="cursor-pointer">
                    Descrição Obrigatória
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Desmarque para tags onde a descrição é opcional
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Placeholder da Descrição</Label>
                <Input
                  placeholder="Ex: Digite o nome do motoboy"
                  value={formPlaceholder}
                  onChange={(e) => setFormPlaceholder(e.target.value)}
                  data-vaul-no-drag
                />
                <p className="text-xs text-muted-foreground">
                  Texto de orientação exibido no campo Descrição ao usar esta tag
                </p>
              </div>

              <div className="space-y-2">
                <Label>Ordem de exibição</Label>
                <Input
                  type="number"
                  min={0}
                  value={formSortOrder}
                  onChange={(e) => setFormSortOrder(Number(e.target.value))}
                  data-vaul-no-drag
                />
              </div>
            </div>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="min-h-[44px]">
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={saving} className="min-h-[44px]">
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingTag ? "Salvar" : "Criar"}
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>
      </div>
    </MainLayout>
  );
}
