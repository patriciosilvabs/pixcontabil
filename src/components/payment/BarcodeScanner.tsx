import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Camera, X } from "lucide-react";

interface BarcodeScannerProps {
  mode: "qrcode" | "barcode";
  isOpen: boolean;
  onScan: (result: string) => void;
  onClose: () => void;
}

const qrcodeFormats = [Html5QrcodeSupportedFormats.QR_CODE];
const barcodeFormats = [
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.EAN_13,
];

export function BarcodeScanner({ mode, isOpen, onScan, onClose }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const containerIdRef = useRef(`scanner-${Date.now()}`);
  const hasScannedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      hasScannedRef.current = false;
      return;
    }

    const startScanner = async () => {
      setError(null);
      setIsStarting(true);
      hasScannedRef.current = false;

      // Small delay to ensure DOM element is rendered
      await new Promise((r) => setTimeout(r, 300));

      const containerId = containerIdRef.current;
      const element = document.getElementById(containerId);
      if (!element) {
        setError("Elemento do scanner não encontrado.");
        setIsStarting(false);
        return;
      }

      try {
        const scanner = new Html5Qrcode(containerId, {
          formatsToSupport: mode === "qrcode" ? qrcodeFormats : barcodeFormats,
          verbose: false,
        });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: mode === "qrcode" ? { width: 250, height: 250 } : { width: 350, height: 150 }, aspectRatio: mode === "barcode" ? 2.0 : 1.0 },
          (decodedText) => {
            if (hasScannedRef.current) return;
            hasScannedRef.current = true;
            onScan(decodedText);
            // Stop after successful scan
            scanner.stop().catch(() => {});
          },
          () => {
            // Ignore scan failures (continuous scanning)
          }
        );
      } catch (err: any) {
        console.error("[BarcodeScanner] Error:", err);
        if (err?.toString?.().includes("NotAllowedError")) {
          setError("Permissão da câmera negada. Habilite nas configurações do navegador.");
        } else if (err?.toString?.().includes("NotFoundError")) {
          setError("Nenhuma câmera encontrada no dispositivo.");
        } else {
          setError("Erro ao acessar a câmera. Verifique as permissões.");
        }
      } finally {
        setIsStarting(false);
      }
    };

    startScanner();

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [isOpen, mode, onScan]);

  const handleClose = () => {
    if (scannerRef.current) {
      scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className={`p-0 gap-0 overflow-hidden ${mode === "barcode" ? "sm:max-w-lg max-w-[95vw]" : "sm:max-w-md"}`}>
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            {mode === "qrcode" ? "Escanear QR Code" : "Escanear Código de Barras"}
          </DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-4">
          {error ? (
            <div className="flex flex-col items-center gap-4 py-8">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-center text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" onClick={handleClose}>
                Fechar
              </Button>
            </div>
          ) : (
            <>
              <div
                id={containerIdRef.current}
                className={`w-full rounded-lg overflow-hidden bg-black ${mode === "barcode" ? "min-h-[350px]" : "min-h-[300px]"}`}
              />
              {isStarting && (
                <p className="text-center text-sm text-muted-foreground mt-3">
                  Iniciando câmera...
                </p>
              )}
              <p className="text-center text-xs text-muted-foreground mt-3">
                {mode === "qrcode"
                  ? "Aponte a câmera para o QR Code Pix"
                  : "Aponte a câmera para o código de barras do boleto"}
              </p>
            </>
          )}

          <Button variant="outline" className="w-full mt-4" onClick={handleClose}>
            <X className="mr-2 h-4 w-4" />
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
