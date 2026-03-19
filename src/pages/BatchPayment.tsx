import { useState, useCallback, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useBatchPayment, BatchPaymentItem } from "@/hooks/useBatchPayment";
import {
  Upload,
  Plus,
  Trash2,
  Play,
  CheckCircle2,
  XCircle,
  Loader2,
  FileSpreadsheet,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MAX_VALUE = 1_000_000;

function parseCSV(text: string): BatchPaymentItem[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Detect separator
  const sep = lines[0].includes(";") ? ";" : ",";

  // Skip header if first cell looks like a header
  const first = lines[0].split(sep)[0].trim().toLowerCase();
  const startIndex = ["tipo", "type", "t"].includes(first) ? 1 : 0;

  const items: BatchPaymentItem[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const cols = lines[i].split(sep).map((c) => c.trim());
    if (cols.length < 3) continue;

    const rawType = cols[0].toLowerCase();
    const type: "pix_key" | "boleto" =
      rawType.includes("boleto") || rawType === "b" ? "boleto" : "pix_key";

    const keyOrCode = cols[1];
    const rawVal = cols[2].replace(/[R$\s]/g, "").replace(",", ".");
    const valor = parseFloat(rawVal);
    const descricao = cols[3] || undefined;

    if (!keyOrCode || isNaN(valor) || valor <= 0) continue;

    const item: BatchPaymentItem = { type, valor, descricao };
    if (type === "pix_key") item.pix_key = keyOrCode;
    else item.codigo_barras = keyOrCode;

    items.push(item);
  }
  return items;
}

export default function BatchPayment() {
  const { toast } = useToast();
  const { isProcessing, results, summary, executeBatch, reset } = useBatchPayment();
  const [items, setItems] = useState<BatchPaymentItem[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Manual entry state
  const [newType, setNewType] = useState<"pix_key" | "boleto">("pix_key");
  const [newKey, setNewKey] = useState("");
  const [newValor, setNewValor] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const addItem = useCallback(() => {
    const rawVal = newValor.replace(/[R$\s]/g, "").replace(",", ".");
    const valor = parseFloat(rawVal);
    if (!newKey.trim()) {
      toast({ variant: "destructive", title: "Erro", description: "Informe a chave/código." });
      return;
    }
    if (isNaN(valor) || valor <= 0 || valor > MAX_VALUE) {
      toast({ variant: "destructive", title: "Erro", description: "Valor inválido." });
      return;
    }
    const item: BatchPaymentItem = { type: newType, valor, descricao: newDesc || undefined };
    if (newType === "pix_key") item.pix_key = newKey.trim();
    else item.codigo_barras = newKey.trim();

    setItems((prev) => [...prev, item]);
    setNewKey("");
    setNewValor("");
    setNewDesc("");
  }, [newType, newKey, newValor, newDesc, toast]);

  const removeItem = useCallback((index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleCSVUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const parsed = parseCSV(text);
        if (parsed.length === 0) {
          toast({ variant: "destructive", title: "CSV vazio", description: "Nenhum item válido encontrado." });
          return;
        }
        if (parsed.length > 50) {
          toast({ variant: "destructive", title: "Limite excedido", description: "Máximo 50 itens. Apenas os primeiros 50 serão adicionados." });
          setItems(parsed.slice(0, 50));
        } else {
          setItems(parsed);
        }
        toast({ title: "CSV importado", description: `${Math.min(parsed.length, 50)} pagamentos carregados.` });
      };
      reader.readAsText(file);
      if (fileRef.current) fileRef.current.value = "";
    },
    [toast]
  );

  const totalValue = items.reduce((s, i) => s + i.valor, 0);

  const handleExecute = useCallback(async () => {
    setShowConfirm(false);
    await executeBatch(items);
  }, [items, executeBatch]);

  const handleNewBatch = useCallback(() => {
    setItems([]);
    reset();
  }, [reset]);

  // Results view
  if (results && summary) {
    return (
      <MainLayout>
        <div className="p-4 pb-24 space-y-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
            </Link>
            <h1 className="text-xl font-bold">Resultado do Lote</h1>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold">{summary.total}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary">{summary.success_count}</p>
                <p className="text-xs text-muted-foreground">Sucesso</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-destructive">{summary.failed_count}</p>
                <p className="text-xs text-muted-foreground">Falhas</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r, i) => {
                    const item = items[r.index];
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{r.index + 1}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item?.type === "boleto" ? "Boleto" : "Pix"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[150px] truncate text-xs">
                          {item?.type === "boleto" ? item.codigo_barras : item?.pix_key}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {item?.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </TableCell>
                        <TableCell className="text-center">
                          {r.success ? (
                            <CheckCircle2 className="h-4 w-4 text-primary mx-auto" />
                          ) : (
                            <div className="flex flex-col items-center">
                              <XCircle className="h-4 w-4 text-destructive" />
                              <span className="text-[10px] text-destructive max-w-[120px] truncate">{r.error}</span>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Button onClick={handleNewBatch} className="w-full">Novo Lote</Button>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="p-4 pb-24 space-y-4 max-w-4xl mx-auto">
        <div className="flex items-center gap-3">
          <Link to="/">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button>
          </Link>
          <h1 className="text-xl font-bold">Pagamento em Lote</h1>
        </div>

        {isProcessing ? (
          <Card>
            <CardContent className="p-8 flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Processando {items.length} pagamentos...</p>
              <p className="text-xs text-muted-foreground">Isso pode levar alguns minutos. Não feche esta página.</p>
              <Progress value={undefined} className="w-full" />
            </CardContent>
          </Card>
        ) : (
          <>
            <Tabs defaultValue="csv">
              <TabsList className="w-full">
                <TabsTrigger value="csv" className="flex-1 gap-1.5">
                  <Upload className="h-4 w-4" /> CSV
                </TabsTrigger>
                <TabsTrigger value="manual" className="flex-1 gap-1.5">
                  <Plus className="h-4 w-4" /> Manual
                </TabsTrigger>
              </TabsList>

              <TabsContent value="csv" className="space-y-3">
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Importe um arquivo CSV com as colunas: <strong>tipo;chave;valor;descricao</strong>
                    </p>
                    <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md font-mono">
                      tipo;chave;valor;descricao<br />
                      pix;email@exemplo.com;150.00;Fornecedor A<br />
                      boleto;23793.38128...;500.00;Conta de luz
                    </div>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.txt"
                      className="hidden"
                      onChange={handleCSVUpload}
                    />
                    <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()}>
                      <FileSpreadsheet className="h-4 w-4" /> Selecionar arquivo CSV
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="manual" className="space-y-3">
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={newType} onValueChange={(v) => setNewType(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pix_key">Pix</SelectItem>
                          <SelectItem value="boleto">Boleto</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Valor (R$)"
                        value={newValor}
                        onChange={(e) => setNewValor(e.target.value)}
                        inputMode="decimal"
                      />
                    </div>
                    <Input
                      placeholder={newType === "pix_key" ? "Chave Pix" : "Código de barras"}
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                    />
                    <Input
                      placeholder="Descrição (opcional)"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                    />
                    <Button onClick={addItem} className="w-full gap-2" variant="secondary">
                      <Plus className="h-4 w-4" /> Adicionar ao lote
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Items preview */}
            {items.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span>{items.length} pagamento{items.length > 1 ? "s" : ""}</span>
                    <span className="text-primary">
                      {totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Destino</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{i + 1}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {item.type === "boleto" ? "Boleto" : "Pix"}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[150px] truncate text-xs">
                            {item.type === "boleto" ? item.codigo_barras : item.pix_key}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            {item.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                          </TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(i)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {items.length > 0 && (
              <div className="space-y-2">
                {items.length > 10 && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded-md">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>Lotes grandes podem levar vários minutos para processar.</span>
                  </div>
                )}
                <Button
                  className="w-full gap-2"
                  size="lg"
                  onClick={() => setShowConfirm(true)}
                  disabled={isProcessing}
                >
                  <Play className="h-4 w-4" />
                  Executar Lote ({items.length} pagamento{items.length > 1 ? "s" : ""})
                </Button>
              </div>
            )}
          </>
        )}

        <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar pagamento em lote</AlertDialogTitle>
              <AlertDialogDescription>
                Você está prestes a executar <strong>{items.length}</strong> pagamento{items.length > 1 ? "s" : ""} totalizando{" "}
                <strong>{totalValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>.
                Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleExecute}>Confirmar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </MainLayout>
  );
}
