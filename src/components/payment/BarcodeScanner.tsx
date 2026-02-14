import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Camera, X, Keyboard, ArrowLeft } from "lucide-react";

interface BarcodeScannerProps {
  mode: "qrcode" | "barcode";
  isOpen: boolean;
  onScan: (result: string) => void;
  onClose: () => void;
  onManualInput?: () => void;
}

const qrcodeFormats = [Html5QrcodeSupportedFormats.QR_CODE];
const barcodeFormats = [
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.EAN_13,
];

export function BarcodeScanner({ mode, isOpen, onScan, onClose, onManualInput }: BarcodeScannerProps) {
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
            scanner.stop().catch(() => {});
          },
          () => {}
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

  const handleManualInput = () => {
    handleClose();
    onManualInput?.();
  };

  // Fullscreen barcode mode
  if (mode === "barcode") {
    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        {/* Scanner area - takes full screen */}
        <div className="relative flex-1">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-6">
              <AlertCircle className="h-16 w-16 text-red-500" />
              <p className="text-center text-white text-lg">{error}</p>
              <Button
                className="bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-3 text-lg rounded-lg"
                onClick={handleClose}
              >
                VOLTAR
              </Button>
            </div>
          ) : (
            <>
              <div
                id={containerIdRef.current}
                className="w-full h-full [&_video]:!w-full [&_video]:!h-full [&_video]:!object-cover [&>div]:!w-full [&>div]:!h-full"
                style={{ minHeight: "100%", width: "100%" }}
              />

              {/* Overlay guide text */}
              <div className="absolute right-6 top-1/2 -translate-y-1/2 pointer-events-none">
                <p
                  className="text-white/80 text-sm font-medium whitespace-nowrap"
                  style={{
                    writingMode: "vertical-rl",
                    textOrientation: "mixed",
                    letterSpacing: "0.1em",
                  }}
                >
                  Posicione o código de barra na linha verde
                </p>
              </div>

              {/* Action buttons on the left */}
              <div className="absolute left-4 top-1/2 -translate-y-1/2 flex flex-col gap-4 z-10">
                <Button
                  className="bg-green-500 hover:bg-green-600 text-white font-bold px-6 py-4 text-base rounded-lg shadow-lg"
                  onClick={handleClose}
                >
                  <ArrowLeft className="mr-2 h-5 w-5" />
                  VOLTAR
                </Button>
                <Button
                  className="bg-green-500 hover:bg-green-600 text-white font-bold px-6 py-4 text-base rounded-lg shadow-lg"
                  onClick={handleManualInput}
                >
                  <Keyboard className="mr-2 h-5 w-5" />
                  DIGITAR CÓDIGO
                </Button>
              </div>

              {isStarting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <p className="text-white text-lg font-medium">Iniciando câmera...</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // QR Code mode - keep dialog
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Escanear QR Code
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
                className="w-full rounded-lg overflow-hidden bg-black min-h-[300px]"
              />
              {isStarting && (
                <p className="text-center text-sm text-muted-foreground mt-3">
                  Iniciando câmera...
                </p>
              )}
              <p className="text-center text-xs text-muted-foreground mt-3">
                Aponte a câmera para o QR Code Pix
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
