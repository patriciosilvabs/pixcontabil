import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getInitials } from "@/lib/utils";
import { Loader2, Users as UsersIcon, Shield, DollarSign } from "lucide-react";

interface MemberRow {
  id: string;
  user_id: string;
  company_id: string;
  is_active: boolean;
  payment_limit: number | null;
  profile: { full_name: string; email: string; avatar_url: string | null } | null;
  role: string | null;
}

export default function Users() {
  const { currentCompany } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editDialog, setEditDialog] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberRow | null>(null);
  const [editRole, setEditRole] = useState<"admin" | "operator">("operator");
  const [editLimit, setEditLimit] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const fetchMembers = async () => {
    if (!currentCompany) return;
    setIsLoading(true);
    try {
      // Fetch members
      const { data: membersData, error } = await supabase
        .from("company_members")
        .select("*")
        .eq("company_id", currentCompany.id)
        .order("created_at");

      if (error) throw error;
      if (!membersData) { setMembers([]); return; }

      // Fetch profiles and roles for each member
      const enriched: MemberRow[] = [];
      for (const m of membersData) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email, avatar_url")
          .eq("user_id", m.user_id)
          .single();

        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", m.user_id)
          .single();

        enriched.push({
          ...m,
          profile: profile || null,
          role: roleData?.role || null,
        });
      }
      setMembers(enriched);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erro ao carregar usuários" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchMembers(); }, [currentCompany]);

  const openEdit = (m: MemberRow) => {
    setEditingMember(m);
    setEditRole((m.role as "admin" | "operator") || "operator");
    setEditLimit(m.payment_limit?.toString() || "");
    setEditDialog(true);
  };

  const handleSave = async () => {
    if (!editingMember) return;
    setIsSaving(true);
    try {
      // Update payment limit
      const { error: memberError } = await supabase
        .from("company_members")
        .update({ payment_limit: editLimit ? parseFloat(editLimit) : null })
        .eq("id", editingMember.id);
      if (memberError) throw memberError;

      // Update role
      if (editRole !== editingMember.role) {
        const { error: roleError } = await supabase
          .from("user_roles")
          .update({ role: editRole })
          .eq("user_id", editingMember.user_id);
        if (roleError) throw roleError;
      }

      toast({ title: "Usuário atualizado!" });
      setEditDialog(false);
      fetchMembers();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (m: MemberRow) => {
    const { error } = await supabase
      .from("company_members")
      .update({ is_active: !m.is_active })
      .eq("id", m.id);
    if (error) toast({ variant: "destructive", title: "Erro" });
    else {
      toast({ title: m.is_active ? "Usuário desativado" : "Usuário ativado" });
      fetchMembers();
    }
  };

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UsersIcon className="h-6 w-6 text-primary" /> Usuários
          </h1>
          <p className="text-muted-foreground">Membros da empresa {currentCompany?.name}</p>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : members.length === 0 ? (
              <div className="text-center text-muted-foreground p-8">Nenhum membro encontrado</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Limite</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                              {getInitials(m.profile?.full_name || "U")}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{m.profile?.full_name || "—"}</p>
                            <p className="text-xs text-muted-foreground">{m.profile?.email || "—"}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.role === "admin" ? "default" : "secondary"}>
                          {m.role === "admin" ? "Admin" : "Operador"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono-numbers">
                        {m.payment_limit != null
                          ? `R$ ${Number(m.payment_limit).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                          : "Sem limite"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.is_active ? "default" : "outline"}>
                          {m.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(m)}>Editar</Button>
                        <Button variant="ghost" size="sm" onClick={() => toggleActive(m)}>
                          {m.is_active ? "Desativar" : "Ativar"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Dialog open={editDialog} onOpenChange={setEditDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar Membro</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Shield className="h-4 w-4" /> Role</Label>
                <Select value={editRole} onValueChange={(v) => setEditRole(v as "admin" | "operator")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="operator">Operador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><DollarSign className="h-4 w-4" /> Limite de Pagamento (R$)</Label>
                <Input type="number" value={editLimit} onChange={(e) => setEditLimit(e.target.value)} placeholder="Sem limite" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditDialog(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
