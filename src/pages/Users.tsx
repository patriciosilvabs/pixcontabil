import { useState, useEffect } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getInitials } from "@/lib/utils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Users as UsersIcon, Shield, DollarSign, UserPlus, Trash2, KeyRound, Check, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

const PAGE_OPTIONS = [
  { key: "dashboard", label: "Dashboard" },
  { key: "new_payment", label: "Novo Pagamento" },
  { key: "transactions", label: "Transações" },
  { key: "categories", label: "Categorias" },
  { key: "reports", label: "Relatórios" },
  { key: "users", label: "Usuários" },
  { key: "companies", label: "Empresas" },
  { key: "settings", label: "Configurações" },
];

const FEATURE_OPTIONS = [
  { key: "menu_pix", label: "MENU PIX" },
  { key: "pagar_qrcode", label: "PAGAR QR CODE" },
  { key: "copia_cola", label: "COPIA E COLA" },
  { key: "com_chave", label: "COM CHAVE" },
  { key: "favorecidos", label: "FAVORECIDOS" },
  { key: "agendadas", label: "AGENDADAS" },
  { key: "boleto", label: "BOLETO" },
  { key: "dinheiro", label: "DINHEIRO" },
  { key: "transferir", label: "TRANSFERIR" },
  { key: "classificar_insumo", label: "CLASSIFICAR CUSTO" },
  { key: "classificar_despesa", label: "CLASSIFICAR DESPESA" },
];

// Permission templates
interface PermissionTemplate {
  label: string;
  description: string;
  role: "admin" | "operator";
  canViewBalance: boolean;
  pages: Record<string, boolean>;
  features: Record<string, boolean>;
  highlights: { label: string; enabled: boolean }[];
}

const PERMISSION_TEMPLATES: Record<string, PermissionTemplate> = {
  gestor: {
    label: "Gestor",
    description: "Acesso total ao sistema",
    role: "operator",
    canViewBalance: true,
    pages: Object.fromEntries(PAGE_OPTIONS.map(p => [p.key, true])),
    features: Object.fromEntries(FEATURE_OPTIONS.map(f => [f.key, true])),
    highlights: [
      { label: "Saldo", enabled: true },
      { label: "Todas as páginas", enabled: true },
      { label: "Classificações", enabled: true },
      { label: "Configurações", enabled: true },
    ],
  },
  operacional: {
    label: "Operacional",
    description: "Pagamentos e transações",
    role: "operator",
    canViewBalance: false,
    pages: Object.fromEntries(PAGE_OPTIONS.map(p => [p.key, !["users", "companies", "settings", "reports"].includes(p.key)])),
    features: Object.fromEntries(FEATURE_OPTIONS.map(f => [f.key, !["classificar_insumo"].includes(f.key)])),
    highlights: [
      { label: "Saldo", enabled: false },
      { label: "Pagamentos", enabled: true },
      { label: "Configurações", enabled: false },
      { label: "Classif. Despesa", enabled: true },
    ],
  },
  caixa: {
    label: "Caixa",
    description: "Apenas pagamentos básicos",
    role: "operator",
    canViewBalance: false,
    pages: Object.fromEntries(PAGE_OPTIONS.map(p => [p.key, ["dashboard", "new_payment", "transactions"].includes(p.key)])),
    features: Object.fromEntries(FEATURE_OPTIONS.map(f => [f.key, !["classificar_insumo", "classificar_despesa", "favorecidos", "agendadas", "transferir"].includes(f.key)])),
    highlights: [
      { label: "Saldo", enabled: false },
      { label: "Pagamentos", enabled: true },
      { label: "Classificações", enabled: false },
      { label: "Favorecidos", enabled: false },
    ],
  },
  caixa_confianca: {
    label: "Caixa Confiança",
    description: "Caixa com saldo e despesas",
    role: "operator",
    canViewBalance: true,
    pages: Object.fromEntries(PAGE_OPTIONS.map(p => [p.key, ["dashboard", "new_payment", "transactions", "categories"].includes(p.key)])),
    features: Object.fromEntries(FEATURE_OPTIONS.map(f => [f.key, !["classificar_insumo", "favorecidos", "agendadas", "transferir"].includes(f.key)])),
    highlights: [
      { label: "Saldo", enabled: true },
      { label: "Pagamentos", enabled: true },
      { label: "Classif. Custo", enabled: false },
      { label: "Classif. Despesa", enabled: true },
    ],
  },
};

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
  const { currentCompany, user } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editDialog, setEditDialog] = useState(false);
  const [addDialog, setAddDialog] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editingMember, setEditingMember] = useState<MemberRow | null>(null);
  const [editRole, setEditRole] = useState<"admin" | "operator">("operator");
  const [editLimit, setEditLimit] = useState("");
  const [editCanViewBalance, setEditCanViewBalance] = useState(false);
  const [editPermissions, setEditPermissions] = useState<Record<string, boolean>>({});
  const [editFeaturePermissions, setEditFeaturePermissions] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deletingMember, setDeletingMember] = useState<MemberRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [passwordDialog, setPasswordDialog] = useState(false);
  const [passwordMember, setPasswordMember] = useState<MemberRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const fetchMembers = async () => {
    if (!currentCompany) return;
    setIsLoading(true);
    try {
      const { data: membersData, error } = await supabase
        .from("company_members")
        .select("*")
        .eq("company_id", currentCompany.id)
        .order("created_at");

      if (error) throw error;
      if (!membersData) { setMembers([]); return; }

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

  const openEdit = async (m: MemberRow) => {
    setEditingMember(m);
    setEditRole((m.role as "admin" | "operator") || "operator");
    setEditLimit(m.payment_limit?.toString() || "");
    setEditCanViewBalance((m as any).can_view_balance ?? false);

    // Load permissions
    const { data: perms } = await supabase
      .from("user_page_permissions")
      .select("page_key, has_access")
      .eq("user_id", m.user_id)
      .eq("company_id", m.company_id);

    const permMap: Record<string, boolean> = {};
    PAGE_OPTIONS.forEach(p => permMap[p.key] = true); // default all true
    perms?.forEach((p: any) => { permMap[p.page_key] = p.has_access; });
    setEditPermissions(permMap);

    // Load feature permissions
    const { data: featurePerms } = await supabase
      .from("user_feature_permissions")
      .select("feature_key, is_visible")
      .eq("user_id", m.user_id)
      .eq("company_id", m.company_id);

    const featureMap: Record<string, boolean> = {};
    FEATURE_OPTIONS.forEach(f => featureMap[f.key] = true); // default all true
    featurePerms?.forEach((f: any) => { featureMap[f.feature_key] = f.is_visible; });
    setEditFeaturePermissions(featureMap);

    // Detect matching template
    const canView = (m as any).can_view_balance ?? false;
    const memberRole = (m.role as "admin" | "operator") || "operator";
    let detectedTemplate: string | null = null;
    for (const [key, tpl] of Object.entries(PERMISSION_TEMPLATES)) {
      const pagesMatch = PAGE_OPTIONS.every(p => (permMap[p.key] ?? true) === tpl.pages[p.key]);
      const featuresMatch = FEATURE_OPTIONS.every(f => (featureMap[f.key] ?? true) === tpl.features[f.key]);
      if (pagesMatch && featuresMatch && tpl.canViewBalance === canView && tpl.role === memberRole) {
        detectedTemplate = key;
        break;
      }
    }
    setSelectedTemplate(detectedTemplate);
    setEditDialog(true);
  };

  const handleSave = async () => {
    if (!editingMember || !currentCompany) return;
    setIsSaving(true);
    try {
      // Update payment limit
      const { error: memberError } = await supabase
        .from("company_members")
        .update({ 
          payment_limit: editLimit ? parseFloat(editLimit) : null,
          can_view_balance: editCanViewBalance,
        } as any)
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

      // Batch upsert page permissions
      const permRows = PAGE_OPTIONS.map(p => ({
        user_id: editingMember.user_id,
        company_id: currentCompany.id,
        page_key: p.key,
        has_access: editPermissions[p.key] ?? true,
      }));

      const { error: permError } = await supabase
        .from("user_page_permissions")
        .upsert(permRows, { onConflict: "user_id,company_id,page_key" });
      if (permError) throw permError;

      // Batch upsert feature permissions
      const featureRows = FEATURE_OPTIONS.map(f => ({
        user_id: editingMember.user_id,
        company_id: currentCompany.id,
        feature_key: f.key,
        is_visible: editFeaturePermissions[f.key] ?? true,
      }));

      const { error: featError } = await supabase
        .from("user_feature_permissions")
        .upsert(featureRows, { onConflict: "user_id,company_id,feature_key" });
      if (featError) throw featError;

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
  const handleDeleteUser = async () => {
    if (!deletingMember) return;
    setIsDeleting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-user`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ user_id: deletingMember.user_id }),
        }
      );

      const result = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Erro", description: result.error });
        return;
      }

      toast({ title: "Usuário excluído permanentemente!" });
      setDeleteDialog(false);
      setDeletingMember(null);
      fetchMembers();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!passwordMember || !newPassword.trim()) return;
    if (newPassword.length < 6) {
      toast({ variant: "destructive", title: "Senha deve ter no mínimo 6 caracteres" });
      return;
    }
    setIsResettingPassword(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-user-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            user_id: passwordMember.user_id,
            new_password: newPassword,
          }),
        }
      );

      const result = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Erro", description: result.error });
        return;
      }

      toast({ title: "Senha alterada com sucesso!", description: `A senha de ${passwordMember.profile?.full_name || "usuário"} foi atualizada.` });
      setPasswordDialog(false);
      setPasswordMember(null);
      setNewPassword("");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleAddUser = async () => {
    if (!currentCompany || !addEmail.trim() || !addName.trim() || !addPassword.trim()) return;
    if (addPassword.length < 6) {
      toast({ variant: "destructive", title: "Senha deve ter no mínimo 6 caracteres" });
      return;
    }
    setIsAdding(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            full_name: addName.trim(),
            email: addEmail.trim().toLowerCase(),
            password: addPassword,
            company_id: currentCompany.id,
          }),
        }
      );

      const result = await res.json();

      if (!res.ok) {
        toast({ variant: "destructive", title: "Erro", description: result.error });
        return;
      }

      toast({ title: "Usuário cadastrado!", description: `${addName.trim()} foi criado e vinculado à empresa.` });
      setAddDialog(false);
      setAddEmail("");
      setAddName("");
      setAddPassword("");
      fetchMembers();
    } catch (error: any) {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <MainLayout>
      <div className="p-6 lg:p-8 max-w-5xl mx-auto">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <UsersIcon className="h-6 w-6 text-primary" /> Usuários
            </h1>
            <p className="text-muted-foreground">Membros da empresa {currentCompany?.name}</p>
          </div>
          <Button onClick={() => setAddDialog(true)} className="gap-2">
            <UserPlus className="h-4 w-4" /> Adicionar
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : members.length === 0 ? (
              <div className="text-center text-muted-foreground p-8">Nenhum membro encontrado</div>
            ) : isMobile ? (
              /* Mobile: Card list */
              <div className="p-3 space-y-3">
                {members.map((m) => (
                  <div key={m.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {getInitials(m.profile?.full_name || "U")}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{m.profile?.full_name || "—"}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.profile?.email || "—"}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={m.role === "admin" ? "default" : "secondary"}>
                        {m.role === "admin" ? "Admin" : "Operador"}
                      </Badge>
                      <Badge variant={m.is_active ? "default" : "outline"}>
                        {m.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                      <Badge variant="outline" className="font-mono">
                        {m.payment_limit != null
                          ? `R$ ${Number(m.payment_limit).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                          : "Sem limite"}
                      </Badge>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" size="sm" className="flex-1 min-h-[44px]" onClick={() => openEdit(m)}>
                        Editar
                      </Button>
                      <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => toggleActive(m)}>
                        {m.is_active ? "Desativar" : "Ativar"}
                      </Button>
                      {user && m.user_id !== user.id && (
                        <>
                          <Button variant="outline" size="sm" className="min-h-[44px]"
                            onClick={() => { setPasswordMember(m); setNewPassword(""); setPasswordDialog(true); }}>
                            <KeyRound className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="min-h-[44px] text-destructive hover:text-destructive"
                            onClick={() => { setDeletingMember(m); setDeleteDialog(true); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
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
                        {user && m.user_id !== user.id && (
                          <>
                            <Button variant="ghost" size="sm"
                              onClick={() => { setPasswordMember(m); setNewPassword(""); setPasswordDialog(true); }}
                              title="Nova Senha">
                              <KeyRound className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive"
                              onClick={() => { setDeletingMember(m); setDeleteDialog(true); }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={editDialog} onOpenChange={setEditDialog}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Editar Membro</DialogTitle>
              <DialogDescription>Altere as permissões e configurações do membro</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Template selector */}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Template de Perfil</Label>
                <p className="text-xs text-muted-foreground">Selecione um template para preencher automaticamente. Você pode ajustar individualmente depois.</p>
                <div className="grid grid-cols-2 gap-3 pt-1">
                  {Object.entries(PERMISSION_TEMPLATES).map(([key, tpl]) => {
                    const isActive = selectedTemplate === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`relative rounded-lg border-2 p-3 text-left transition-all ${
                          isActive
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border hover:border-muted-foreground/30 hover:bg-muted/50"
                        }`}
                        onClick={() => {
                          setSelectedTemplate(key);
                          setEditRole(tpl.role);
                          setEditCanViewBalance(tpl.canViewBalance);
                          setEditPermissions({ ...tpl.pages });
                          setEditFeaturePermissions({ ...tpl.features });
                        }}
                      >
                        {isActive && (
                          <Badge className="absolute -top-2 -right-2 text-[10px] px-1.5 py-0">
                            Ativo
                          </Badge>
                        )}
                        <span className="font-semibold text-sm block">{tpl.label}</span>
                        <span className="text-xs text-muted-foreground block mb-2">{tpl.description}</span>
                        <div className="flex flex-wrap gap-1">
                          {tpl.highlights.map((h, i) => (
                            <span
                              key={i}
                              className={`inline-flex items-center gap-0.5 text-[10px] rounded px-1.5 py-0.5 font-medium ${
                                h.enabled
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "bg-destructive/10 text-destructive"
                              }`}
                            >
                              {h.enabled ? <Check className="h-2.5 w-2.5" /> : <X className="h-2.5 w-2.5" />}
                              {h.label}
                            </span>
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t pt-4 space-y-4">
                <div className="flex items-center gap-2">
                  {selectedTemplate && (
                    <Badge variant="secondary" className="text-xs">
                      Perfil: {PERMISSION_TEMPLATES[selectedTemplate].label}
                    </Badge>
                  )}
                  <p className="text-xs text-muted-foreground font-medium">
                    {selectedTemplate ? "Ajustes abaixo sobrescrevem o template selecionado" : "Ajustes individuais"}
                  </p>
                </div>

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
                <div className="space-y-2">
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="can-view-balance"
                      checked={editCanViewBalance}
                      onCheckedChange={(checked) => setEditCanViewBalance(!!checked)}
                    />
                    <Label htmlFor="can-view-balance" className="text-sm cursor-pointer">
                      Visualizar Saldo da Conta
                    </Label>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Acesso às Páginas</Label>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {PAGE_OPTIONS.map(page => (
                      <div key={page.key} className="flex items-center gap-2">
                        <Checkbox
                          id={`perm-${page.key}`}
                          checked={editPermissions[page.key] ?? true}
                          onCheckedChange={(checked) =>
                            setEditPermissions(prev => ({ ...prev, [page.key]: !!checked }))
                          }
                        />
                        <Label htmlFor={`perm-${page.key}`} className="text-sm cursor-pointer">
                          {page.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Funções e Classificações</Label>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {FEATURE_OPTIONS.map(feature => (
                      <div key={feature.key} className="flex items-center gap-2">
                        <Checkbox
                          id={`feat-${feature.key}`}
                          checked={editFeaturePermissions[feature.key] ?? true}
                          onCheckedChange={(checked) =>
                            setEditFeaturePermissions(prev => ({ ...prev, [feature.key]: !!checked }))
                          }
                        />
                        <Label htmlFor={`feat-${feature.key}`} className="text-sm cursor-pointer">
                          {feature.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
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

        <Dialog open={addDialog} onOpenChange={setAddDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adicionar Usuário</DialogTitle>
              <DialogDescription>Cadastre um novo membro para a empresa</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome completo</Label>
                <Input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="Nome do usuário"
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="usuario@email.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Senha</Label>
                <Input
                  type="password"
                  value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setAddDialog(false); setAddEmail(""); setAddName(""); setAddPassword(""); }}>Cancelar</Button>
              <Button onClick={handleAddUser} disabled={isAdding || !addEmail.trim() || !addName.trim() || !addPassword.trim()}>
                {isAdding && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Cadastrar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteDialog} onOpenChange={setDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir usuário permanentemente?</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir <strong>{deletingMember?.profile?.full_name || "este usuário"}</strong>? 
                Esta ação é irreversível e removerá todos os dados do usuário do sistema.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteUser}
                disabled={isDeleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={passwordDialog} onOpenChange={(open) => { setPasswordDialog(open); if (!open) setNewPassword(""); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova Senha</DialogTitle>
              <DialogDescription>
                Definir nova senha para <strong>{passwordMember?.profile?.full_name || "usuário"}</strong> ({passwordMember?.profile?.email})
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label>Nova Senha</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setPasswordDialog(false); setNewPassword(""); }}>Cancelar</Button>
              <Button onClick={handleResetPassword} disabled={isResettingPassword || newPassword.length < 6}>
                {isResettingPassword && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </MainLayout>
  );
}
