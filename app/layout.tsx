import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Festival Blockchain UNQ 2026',
  description: 'Entradas para una noche ficticia de charlas, musica, comida y comunidad.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
