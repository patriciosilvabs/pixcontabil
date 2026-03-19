import { useState, useEffect, useCallback } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw, Eye, RotateCcw, Activity, CheckCircle2, XCircle, AlertTriangle, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface WebhookEvent {
  id: string;
  provider: string;
  event_type: string;
  transaction_id: string | null;
  app_origin: string | null;
  status: string;
  dispatch_status: string | null;
  dispatch_attempts: number;
  created_at: string;
  processed_at: string | null;
  error_message: string | null;
}

interface WebhookEventDetail extends WebhookEvent {
  idempotency_key: string;
  payload: any;
  normalized_payload: any;
  tenant_id: string | null;
  ip_address: string | null;
  dispatch_response: any;
  company_id: string | null;
  max_retries: number;
  next_retry_at: string | null;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: any }> = {
  received: { label: "Recebido", variant: "outline", icon: Clock },
  processing: { label: "Processando", variant: "secondary", icon: Loader2 },
  processed: { label: "Processado", variant: "default", icon: CheckCircle2 },
  failed: { label: "Falhou", variant: "destructive", icon: XCircle },
  unknown_origin: { label: "Origem Desconhecida", variant: "outline", icon: AlertTriangle },
};

const dispatchConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pendente", variant: "outline" },
  dispatched: { label: "Enviado", variant: "default" },
  failed: { label: "Falhou", variant: "destructive" },
  skipped: { label: "Ignorado", variant: "secondary" },
};

export default function WebhookEvents() {
  const { isAdmin } = useAuth();
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState<WebhookEventDetail | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const limit = 25;

  const fetchEvents = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('webhook_events')
        .select('id, provider, event_type, transaction_id, app_origin, status, dispatch_status, dispatch_attempts, created_at, processed_at, error_message', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(page * limit, (page + 1) * limit - 1);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      setEvents((data || []) as unknown as WebhookEvent[]);
      setTotal(count || 0);
    } catch (e: any) {
      toast.error("Erro ao carregar eventos: " + e.message);
    } finally {
      setIsLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const viewDetail = async (eventId: string) => {
    try {
      const { data, error } = await supabase
        .from('webhook_events')
        .select('*')
        .eq('id', eventId)
        .single();
      if (error) throw error;
      setSelectedEvent(data as unknown as WebhookEventDetail);
      setIsDetailOpen(true);
    } catch (e: any) {
      toast.error("Erro ao carregar detalhes: " + e.message);
    }
  };

  const reprocessEvent = async (eventId: string) => {
    setIsReprocessing(eventId);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const resp = await fetch(
        `https://${projectId}.supabase.co/functions/v1/pix-webhook-gateway?reprocess=${eventId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        }
      );
      if (!resp.ok) throw new Error('Falha ao reprocessar');
      toast.success("Evento reprocessado com sucesso");
      fetchEvents();
    } catch (e: any) {
      toast.error("Erro ao reprocessar: " + e.message);
    } finally {
      setIsReprocessing(null);
    }
  };

  const stats = {
    total: events.length,
    processed: events.filter(e => e.status === 'processed').length,
    failed: events.filter(e => e.status === 'failed').length,
    unknown: events.filter(e => e.status === 'unknown_origin').length,
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Webhook Gateway</h1>
            <p className="text-muted-foreground text-sm">Monitoramento de eventos de pagamento</p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchEvents} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Activity className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{stats.processed}</p>
                <p className="text-xs text-muted-foreground">Processados</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <XCircle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-2xl font-bold">{stats.failed}</p>
                <p className="text-xs text-muted-foreground">Falharam</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-accent-foreground" />
              <div>
                <p className="text-2xl font-bold">{stats.unknown}</p>
                <p className="text-xs text-muted-foreground">Sem Origem</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters + Table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Eventos</CardTitle>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filtrar status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="received">Recebido</SelectItem>
                  <SelectItem value="processing">Processando</SelectItem>
                  <SelectItem value="processed">Processado</SelectItem>
                  <SelectItem value="failed">Falhou</SelectItem>
                  <SelectItem value="unknown_origin">Sem Origem</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : events.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">Nenhum evento encontrado</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Transaction ID</TableHead>
                        <TableHead>App Origem</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Dispatch</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map(evt => {
                        const sc = statusConfig[evt.status] || statusConfig.received;
                        const dc = dispatchConfig[evt.dispatch_status || 'pending'] || dispatchConfig.pending;
                        const Icon = sc.icon;
                        return (
                          <TableRow key={evt.id}>
                            <TableCell className="text-xs whitespace-nowrap">
                              {format(new Date(evt.created_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-mono">{evt.event_type}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs font-mono truncate max-w-[120px] block">{evt.transaction_id || '—'}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs">{evt.app_origin || '—'}</span>
                            </TableCell>
                            <TableCell>
                              <Badge variant={sc.variant} className="gap-1 text-xs">
                                <Icon className="h-3 w-3" />
                                {sc.label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <Badge variant={dc.variant} className="text-xs">
                                {dc.label}
                                {evt.dispatch_attempts > 0 && ` (${evt.dispatch_attempts}x)`}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex gap-1 justify-end">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => viewDetail(evt.id)}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                {isAdmin && (evt.status === 'failed' || evt.status === 'unknown_origin') && (
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => reprocessEvent(evt.id)}
                                    disabled={isReprocessing === evt.id}>
                                    {isReprocessing === evt.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-muted-foreground">
                    {page * limit + 1}–{Math.min((page + 1) * limit, total)} de {total}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                    <Button variant="outline" size="sm" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>Próximo</Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Event Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh]">
          <DialogHeader>
            <DialogTitle>Detalhes do Evento</DialogTitle>
          </DialogHeader>
          {selectedEvent && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-4 pr-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{selectedEvent.id}</span></div>
                  <div><span className="text-muted-foreground">Provedor:</span> {selectedEvent.provider}</div>
                  <div><span className="text-muted-foreground">Tipo:</span> {selectedEvent.event_type}</div>
                  <div><span className="text-muted-foreground">TX ID:</span> <span className="font-mono text-xs">{selectedEvent.transaction_id || '—'}</span></div>
                  <div><span className="text-muted-foreground">App Origem:</span> {selectedEvent.app_origin || '—'}</div>
                  <div><span className="text-muted-foreground">Tenant:</span> {selectedEvent.tenant_id || '—'}</div>
                  <div><span className="text-muted-foreground">IP:</span> {selectedEvent.ip_address || '—'}</div>
                  <div><span className="text-muted-foreground">Tentativas:</span> {selectedEvent.dispatch_attempts}/{selectedEvent.max_retries}</div>
                  <div><span className="text-muted-foreground">Criado:</span> {format(new Date(selectedEvent.created_at), "dd/MM/yyyy HH:mm:ss")}</div>
                  <div><span className="text-muted-foreground">Processado:</span> {selectedEvent.processed_at ? format(new Date(selectedEvent.processed_at), "dd/MM/yyyy HH:mm:ss") : '—'}</div>
                </div>

                {selectedEvent.error_message && (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                    <p className="text-sm font-medium text-destructive">Erro</p>
                    <p className="text-xs text-destructive/80 mt-1">{selectedEvent.error_message}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm font-medium mb-2">Evento Normalizado</p>
                  <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto">{JSON.stringify(selectedEvent.normalized_payload, null, 2)}</pre>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2">Payload Original</p>
                  <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto">{JSON.stringify(selectedEvent.payload, null, 2)}</pre>
                </div>

                {selectedEvent.dispatch_response && (
                  <div>
                    <p className="text-sm font-medium mb-2">Resposta do Dispatch</p>
                    <pre className="bg-muted rounded-md p-3 text-xs overflow-x-auto">{JSON.stringify(selectedEvent.dispatch_response, null, 2)}</pre>
                  </div>
                )}

                {isAdmin && (selectedEvent.status === 'failed' || selectedEvent.status === 'unknown_origin') && (
                  <Button className="w-full" variant="outline" onClick={() => { reprocessEvent(selectedEvent.id); setIsDetailOpen(false); }}>
                    <RotateCcw className="h-4 w-4 mr-2" /> Reprocessar Evento
                  </Button>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}
