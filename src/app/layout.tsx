import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CineGrid — sua semana de filmes",
  description: "Transforme os filmes recentes do seu diário público do Letterboxd em uma colagem de pôsteres. Sem cadastro. Baixe em PNG.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
