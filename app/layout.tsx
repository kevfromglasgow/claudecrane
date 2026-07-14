import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'OHL Crane Lift Planner',
  description: 'Crane lift planning tool for overhead line lattice tower construction',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
