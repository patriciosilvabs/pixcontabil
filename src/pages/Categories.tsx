import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Plus, Pencil, Power, FolderOpen, Filter } from "lucide-react";

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState<"all" | Classification>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
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

  const filtered = categories.filter((c) => filter === "all" || c.classification === filter);

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FolderOpen className="h-6 w-6 text-primary" /> Categorias
            </h1>
            <p className="text-muted-foreground">Gerencie as categorias de custos e despesas</p>
          </div>
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-2" /> Nova Categoria</Button>
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
            ) : (
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Categoria" : "Nova Categoria"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome da categoria" />
              </div>
              <div className="space-y-2">
                <Label>Classificação</Label>
                <Select value={form.classification} onValueChange={(v) => setForm({ ...form, classification: v as Classification })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cost">Custo</SelectItem>
                    <SelectItem value="expense">Despesa</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Keywords (separadas por vírgula)</Label>
                <Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="aluguel, energia, água" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={isSaving || !form.name.trim()}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingId ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
