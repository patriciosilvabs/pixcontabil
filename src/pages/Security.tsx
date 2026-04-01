import { MainLayout } from "@/components/layout/MainLayout";
import { useSecurityData } from "@/hooks/useSecurityData";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Shield, ShieldAlert, ShieldOff, Activity, AlertTriangle, Ban,
  CheckCircle, XCircle, Loader2,
} from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

const severityColors: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-white",
  low: "bg-muted text-muted-foreground",
};

const statusColors: Record<string, string> = {
  open: "bg-destructive/10 text-destructive border-destructive/20",
  investigating: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  resolved: "bg-green-500/10 text-green-700 border-green-500/20",
  dismissed: "bg-muted text-muted-foreground border-border",
};

const eventTypeLabels: Record<string, string> = {
  login_failed: "Login Falho",
  access_denied: "Acesso Negado",
  rate_limit: "Rate Limit",
  invalid_token: "Token Inválido",
  user_enumeration: "Enumeração de Usuários",
};

function formatDate(d: string) {
  return format(new Date(d), "dd/MM/yy HH:mm", { locale: ptBR });
}

export default function Security() {
  const {
    metrics, events, alerts, ipBlocks, isLoading, activeTab, setActiveTab,
    resolveAlert, dismissAlert, blockIp, unblockIp,
  } = useSecurityData();

  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [newIp, setNewIp] = useState("");
  const [newReason, setNewReason] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleAction = async (id: string, action: () => Promise<void>, label: string) => {
    setActionLoading(id);
    try {
      await action();
      toast({ title: `${label} com sucesso` });
    } catch {
      toast({ title: "Erro", description: "Falha na operação", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBlockIp = async () => {
    if (!newIp.trim() || !newReason.trim()) return;
    setActionLoading("block-new");
    try {
      await blockIp(newIp.trim(), newReason.trim());
      setNewIp("");
      setNewReason("");
      toast({ title: "IP bloqueado com sucesso" });
    } catch {
      toast({ title: "Erro ao bloquear IP", variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const riskLevel = metrics.critical_alerts > 0 ? "Crítico" : metrics.open_alerts > 5 ? "Alto" : metrics.open_alerts > 0 ? "Médio" : "Baixo";
  const riskColor = metrics.critical_alerts > 0 ? "text-destructive" : metrics.open_alerts > 5 ? "text-orange-500" : metrics.open_alerts > 0 ? "text-yellow-500" : "text-green-500";

  return (
    <MainLayout>
      <div className="p-4 lg:p-8 space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">Central de Segurança</h1>
            <p className="text-sm text-muted-foreground">Monitoramento de ameaças e eventos</p>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Activity className="h-4 w-4" /> Eventos (24h)
              </CardTitle>
            </CardHeader>
            <CardContent><p className="text-3xl font-bold">{isLoading ? "—" : metrics.events_24h}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <ShieldAlert className="h-4 w-4" /> Alertas Abertos
              </CardTitle>
            </CardHeader>
            <CardContent><p className="text-3xl font-bold">{isLoading ? "—" : metrics.open_alerts}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Ban className="h-4 w-4" /> IPs Bloqueados
              </CardTitle>
            </CardHeader>
            <CardContent><p className="text-3xl font-bold">{isLoading ? "—" : metrics.blocked_ips}</p></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Nível de Risco
              </CardTitle>
            </CardHeader>
            <CardContent><p className={`text-3xl font-bold ${riskColor}`}>{isLoading ? "—" : riskLevel}</p></CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full lg:w-auto">
            <TabsTrigger value="alerts">Alertas</TabsTrigger>
            <TabsTrigger value="events">Eventos</TabsTrigger>
            <TabsTrigger value="ip-blocks">IPs</TabsTrigger>
          </TabsList>

          {/* Alerts Tab */}
          <TabsContent value="alerts">
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                ) : alerts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShieldOff className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Nenhum alerta registrado</p>
                  </div>
                ) : isMobile ? (
                  <div className="p-3 space-y-3">
                    {alerts.map((alert) => (
                      <div key={alert.id} className="rounded-lg border bg-card p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge className={severityColors[alert.severity] || ""}>{alert.severity}</Badge>
                          <Badge variant="outline" className={statusColors[alert.status] || ""}>{alert.status}</Badge>
                        </div>
                        <p className="font-medium text-sm">{alert.title}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{alert.description}</p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-mono">{alert.source_ip || "—"}</span>
                          <span>{formatDate(alert.created_at)}</span>
                        </div>
                        {alert.status === "open" && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" className="flex-1 min-h-[44px]"
                              onClick={() => handleAction(alert.id, () => resolveAlert(alert.id), "Alerta resolvido")}
                              disabled={actionLoading === alert.id}>
                              <CheckCircle className="h-4 w-4 mr-2 text-green-500" /> Resolver
                            </Button>
                            <Button size="sm" variant="outline" className="flex-1 min-h-[44px]"
                              onClick={() => handleAction(alert.id, () => dismissAlert(alert.id), "Alerta dispensado")}
                              disabled={actionLoading === alert.id}>
                              <XCircle className="h-4 w-4 mr-2" /> Dispensar
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Severidade</TableHead>
                        <TableHead>Título</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {alerts.map((alert) => (
                        <TableRow key={alert.id}>
                          <TableCell><Badge className={severityColors[alert.severity] || ""}>{alert.severity}</Badge></TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{alert.title}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1">{alert.description}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{alert.source_ip || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className={statusColors[alert.status] || ""}>{alert.status}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(alert.created_at)}</TableCell>
                          <TableCell>
                            {alert.status === "open" && (
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost"
                                  onClick={() => handleAction(alert.id, () => resolveAlert(alert.id), "Alerta resolvido")}
                                  disabled={actionLoading === alert.id}>
                                  <CheckCircle className="h-4 w-4 text-green-500" />
                                </Button>
                                <Button size="sm" variant="ghost"
                                  onClick={() => handleAction(alert.id, () => dismissAlert(alert.id), "Alerta dispensado")}
                                  disabled={actionLoading === alert.id}>
                                  <XCircle className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Events Tab */}
          <TabsContent value="events">
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                ) : events.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Nenhum evento registrado</p>
                  </div>
                ) : isMobile ? (
                  <div className="p-3 space-y-3">
                    {events.map((event) => (
                      <div key={event.id} className="rounded-lg border bg-card p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="outline">{eventTypeLabels[event.event_type] || event.event_type}</Badge>
                          <Badge className={severityColors[event.severity] || ""}>{event.severity}</Badge>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-mono">{event.ip_address}</span>
                          <span>{formatDate(event.created_at)}</span>
                        </div>
                        {(event.metadata?.email || event.user_agent) && (
                          <p className="text-xs text-muted-foreground truncate">
                            {(event.metadata as any)?.email || event.user_agent || "—"}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Severidade</TableHead>
                        <TableHead>IP</TableHead>
                        <TableHead>Detalhes</TableHead>
                        <TableHead>Data</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell><Badge variant="outline">{eventTypeLabels[event.event_type] || event.event_type}</Badge></TableCell>
                          <TableCell><Badge className={severityColors[event.severity] || ""}>{event.severity}</Badge></TableCell>
                          <TableCell className="font-mono text-xs">{event.ip_address}</TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {(event.metadata as any)?.email || event.user_agent || "—"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(event.created_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* IP Blocks Tab */}
          <TabsContent value="ip-blocks">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Bloquear novo IP</CardTitle>
                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <Input placeholder="Endereço IP" value={newIp} onChange={(e) => setNewIp(e.target.value)} className="sm:w-48" data-vaul-no-drag />
                  <Input placeholder="Motivo do bloqueio" value={newReason} onChange={(e) => setNewReason(e.target.value)} className="sm:flex-1" data-vaul-no-drag />
                  <Button onClick={handleBlockIp} disabled={actionLoading === "block-new" || !newIp || !newReason} className="min-h-[44px]">
                    {actionLoading === "block-new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4 mr-2" />}
                    Bloquear
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
                ) : ipBlocks.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Ban className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Nenhum IP bloqueado</p>
                  </div>
                ) : isMobile ? (
                  <div className="p-3 space-y-3">
                    {ipBlocks.map((block) => (
                      <div key={block.id} className="rounded-lg border bg-card p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono font-medium text-sm">{block.ip_address}</span>
                          <Badge variant={block.is_active ? "destructive" : "secondary"}>
                            {block.is_active ? "Ativo" : "Inativo"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{block.reason}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{formatDate(block.blocked_at)}</span>
                          {block.is_active && (
                            <Button size="sm" variant="outline" className="min-h-[44px]"
                              onClick={() => handleAction(block.id, () => unblockIp(block.id), "IP desbloqueado")}
                              disabled={actionLoading === block.id}>
                              {actionLoading === block.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Desbloquear"}
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>IP</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Bloqueado em</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ipBlocks.map((block) => (
                        <TableRow key={block.id}>
                          <TableCell className="font-mono font-medium">{block.ip_address}</TableCell>
                          <TableCell className="text-sm max-w-[200px] truncate">{block.reason}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{formatDate(block.blocked_at)}</TableCell>
                          <TableCell>
                            <Badge variant={block.is_active ? "destructive" : "secondary"}>
                              {block.is_active ? "Ativo" : "Inativo"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {block.is_active && (
                              <Button size="sm" variant="outline"
                                onClick={() => handleAction(block.id, () => unblockIp(block.id), "IP desbloqueado")}
                                disabled={actionLoading === block.id}>
                                {actionLoading === block.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Desbloquear"}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
