import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Festival Blockchain UNQ 2026',
  description: 'Venta de entradas NFT ERC-721 para el Festival Blockchain UNQ 2026.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
