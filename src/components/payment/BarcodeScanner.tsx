import { useEffect, useRef, useState, useCallback } from "react";
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

const barcodeFormats = [
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.EAN_13,
];

const qrFormats = [
  Html5QrcodeSupportedFormats.QR_CODE,
];

export function BarcodeScanner({ mode, isOpen, onScan, onClose, onManualInput }: BarcodeScannerProps) {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const containerIdRef = useRef(`scanner-${Math.random().toString(36).slice(2)}`);
  const hasScannedRef = useRef(false);
  const mountedRef = useRef(true);

  const stopScanner = useCallback(() => {
    if (scannerRef.current) {
      const s = scannerRef.current;
      scannerRef.current = null;
      s.stop().catch(() => {});
      try { s.clear(); } catch {}
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      hasScannedRef.current = false;
      stopScanner();
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      setError(null);
      setIsStarting(true);
      hasScannedRef.current = false;

      // Wait for DOM to render
      await new Promise((r) => setTimeout(r, 500));

      if (cancelled || !mountedRef.current) return;

      const containerId = containerIdRef.current;
      const element = document.getElementById(containerId);
      if (!element) {
        setError("Elemento do scanner não encontrado.");
        setIsStarting(false);
        return;
      }

      // Ensure container has dimensions
      if (element.clientWidth === 0 || element.clientHeight === 0) {
        element.style.width = "100%";
        element.style.minHeight = "300px";
      }

      try {
        // Stop any existing scanner
        stopScanner();

        const isBarcode = mode === "barcode";

        const scanner = new Html5Qrcode(containerId, {
          formatsToSupport: isBarcode ? barcodeFormats : qrFormats,
          verbose: false,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
        });

        if (cancelled) {
          scanner.stop().catch(() => {});
          return;
        }

        scannerRef.current = scanner;

        const config: any = {
          fps: isBarcode ? 15 : 10,
          disableFlip: isBarcode,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
        };

        if (mode === "qrcode") {
          config.qrbox = { width: 250, height: 250 };
        }

        // Pass HD video constraints for barcode mode directly
        if (isBarcode) {
          config.videoConstraints = {
            facingMode: "environment",
            width: { min: 1280, ideal: 1920 },
            height: { min: 720, ideal: 1080 },
          };
        }

        await scanner.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            if (hasScannedRef.current) return;
            hasScannedRef.current = true;
            console.log("[BarcodeScanner] Scanned:", decodedText);
            onScan(decodedText);
            stopScanner();
          },
          () => {} // ignore scan failures
        );

        if (mountedRef.current) setIsStarting(false);
      } catch (err: any) {
        console.error("[BarcodeScanner] Error:", err);
        if (!mountedRef.current) return;
        if (err?.toString?.().includes("NotAllowedError")) {
          setError("Permissão da câmera negada. Habilite nas configurações do navegador.");
        } else if (err?.toString?.().includes("NotFoundError")) {
          setError("Nenhuma câmera encontrada no dispositivo.");
        } else {
          setError(`Erro ao acessar a câmera: ${err?.message || err}`);
        }
        setIsStarting(false);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [isOpen, mode]); // removed onScan from deps to prevent re-init loops

  const handleClose = () => {
    stopScanner();
    onClose();
  };

  const handleManualInput = () => {
    stopScanner();
    onClose();
    onManualInput?.();
  };

  // Fullscreen barcode mode
  if (mode === "barcode") {
    if (!isOpen) return null;

    return (
      <div className="fixed inset-0 z-[100] bg-black flex flex-col">
        <div className="relative flex-1 overflow-hidden">
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
                className="w-full h-full barcode-fullscreen"
                style={{ minHeight: "100vh" }}
              />

              {/* Horizontal scan guide line */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10">
                <div className="w-[80vw] h-[2px] bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
              </div>

              {/* Guide text */}
              <div className="absolute top-8 left-0 right-0 pointer-events-none z-10">
                <p className="text-white/90 text-sm font-medium text-center tracking-wider">
                  Posicione o código de barras na linha verde
                </p>
              </div>

              {/* Action buttons - centered at bottom */}
              <div className="absolute bottom-8 left-0 right-0 flex justify-center gap-4 z-10 px-4">
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
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
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
                className="w-full rounded-lg overflow-hidden bg-black"
                style={{ minHeight: "300px" }}
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
