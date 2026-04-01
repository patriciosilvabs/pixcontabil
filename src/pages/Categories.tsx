import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, Pencil, Power, FolderOpen, FileUp, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BatchCategoryDialog } from "@/components/categories/BatchCategoryDialog";

type Classification = "cost" | "expense";

interface Category {
  id: string;
  name: string;
  classification: Classification;
  is_active: boolean;
  keywords: string[] | null;
  company_id: string;
}

export default function Categories() {
  const { currentCompany } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | Classification>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [form, setForm] = useState({ name: "", classification: "cost" as Classification, keywords: "" });

  const fetchCategories = async () => {
    if (!currentCompany) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("name");
    if (data) setCategories(data as Category[]);
    if (error) toast({ variant: "destructive", title: "Erro ao carregar categorias" });
    setIsLoading(false);
  };

  useEffect(() => { fetchCategories(); }, [currentCompany]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", classification: "cost", keywords: "" });
    setDialogOpen(true);
  };

  const openEdit = (cat: Category) => {
    setEditingId(cat.id);
    setForm({ name: cat.name, classification: cat.classification, keywords: (cat.keywords || []).join(", ") });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!currentCompany || !form.name.trim()) return;
    setIsSaving(true);
    const keywords = form.keywords.split(",").map((k) => k.trim()).filter(Boolean);
    try {
      if (editingId) {
        const { error } = await supabase
          .from("categories")
          .update({ name: form.name, classification: form.classification, keywords })
          .eq("id", editingId);
        if (error) throw error;
        toast({ title: "Categoria atualizada!" });
      } else {
        const { error } = await supabase
          .from("categories")
          .insert({ name: form.name, classification: form.classification, keywords, company_id: currentCompany.id });
        if (error) throw error;
        toast({ title: "Categoria criada!" });
      }
      setDialogOpen(false);
      fetchCategories();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (cat: Category) => {
    const { error } = await supabase
      .from("categories")
      .update({ is_active: !cat.is_active })
      .eq("id", cat.id);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao alterar status" });
    } else {
      toast({ title: cat.is_active ? "Categoria desativada" : "Categoria ativada" });
      fetchCategories();
    }
  };

  const openDeleteConfirm = (id: string) => {
    setDeletingId(id);
    setConfirmDeleteOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    const { error } = await supabase.from("categories").delete().eq("id", deletingId);
    if (error) {
      toast({ variant: "destructive", title: "Erro ao remover categoria", description: error.message });
    } else {
      toast({ title: "Categoria removida permanentemente!" });
      fetchCategories();
    }
    setConfirmDeleteOpen(false);
    setDeletingId(null);
  };

  const filtered = categories.filter((c) => filter === "all" || c.classification === filter);

  return (
    <MainLayout>
      <div className="p-4 lg:p-8 max-w-5xl mx-auto">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FolderOpen className="h-6 w-6 text-primary" /> Categorias
            </h1>
            <p className="text-muted-foreground">Gerencie as categorias de custos e despesas</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setBatchDialogOpen(true)}><FileUp className="h-4 w-4 mr-2" /> Importar</Button>
            <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Nova Categoria</Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-4">
          {(["all", "cost", "expense"] as const).map((f) => (
            <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)}>
              {f === "all" ? "Todas" : f === "cost" ? "Custos" : "Despesas"}
            </Button>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center text-muted-foreground p-8">Nenhuma categoria encontrada</div>
            ) : isMobile ? (
              /* Mobile: Card list */
              <div className="p-3 space-y-3">
                {filtered.map((cat) => (
                  <div key={cat.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1.5 min-w-0">
                        <p className="font-medium">{cat.name}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={cat.classification === "cost" ? "default" : "secondary"}>
                            {cat.classification === "cost" ? "Custo" : "Despesa"}
                          </Badge>
                          <Badge variant={cat.is_active ? "default" : "outline"}>
                            {cat.is_active ? "Ativa" : "Inativa"}
                          </Badge>
                        </div>
                        {(cat.keywords || []).length > 0 && (
                          <p className="text-xs text-muted-foreground truncate">
                            {(cat.keywords || []).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 min-h-[44px]" onClick={() => openEdit(cat)}>
                        <Pencil className="h-4 w-4 mr-2" /> Editar
                      </Button>
                      <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => toggleActive(cat)}>
                        <Power className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" className="min-h-[44px] text-destructive hover:text-destructive" onClick={() => openDeleteConfirm(cat.id)}>
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
                      <TableHead>Nome</TableHead>
                      <TableHead>Classificação</TableHead>
                      <TableHead>Keywords</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((cat) => (
                      <TableRow key={cat.id}>
                        <TableCell className="font-medium">{cat.name}</TableCell>
                        <TableCell>
                          <Badge variant={cat.classification === "cost" ? "default" : "secondary"}>
                            {cat.classification === "cost" ? "Custo" : "Despesa"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {(cat.keywords || []).join(", ") || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={cat.is_active ? "default" : "outline"}>
                            {cat.is_active ? "Ativa" : "Inativa"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(cat)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => toggleActive(cat)}>
                            <Power className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => openDeleteConfirm(cat.id)} className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dialog — Drawer on mobile */}
        <ResponsiveDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <ResponsiveDialogContent>
            <ResponsiveDialogHeader>
              <ResponsiveDialogTitle>{editingId ? "Editar Categoria" : "Nova Categoria"}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription>Defina o nome, classificação e palavras-chave</ResponsiveDialogDescription>
            </ResponsiveDialogHeader>
            <div className={`space-y-4 ${isMobile ? "px-4" : ""}`}>
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome da categoria" data-vaul-no-drag />
              </div>
              <div className="space-y-2">
                <Label>Classificação</Label>
                <Select value={form.classification} onValueChange={(v) => setForm({ ...form, classification: v as Classification })}>
                  <SelectTrigger data-vaul-no-drag><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cost">Custo</SelectItem>
                    <SelectItem value="expense">Despesa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Keywords (separadas por vírgula)</Label>
                <Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="aluguel, energia, água" data-vaul-no-drag />
              </div>
            </div>
            <ResponsiveDialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="min-h-[44px]">Cancelar</Button>
              <Button onClick={handleSave} disabled={isSaving || !form.name.trim()} className="min-h-[44px]">
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingId ? "Salvar" : "Criar"}
              </Button>
            </ResponsiveDialogFooter>
          </ResponsiveDialogContent>
        </ResponsiveDialog>

        {currentCompany && (
          <BatchCategoryDialog
            open={batchDialogOpen}
            onOpenChange={setBatchDialogOpen}
            companyId={currentCompany.id}
            onSuccess={fetchCategories}
          />
        )}

        <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover categoria</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja remover esta categoria permanentemente? Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Remover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}
