import { CollageForm } from "@/components/collage-form";
import { Credits } from "@/components/credits";
import Link from "next/link";

export default function Home() {
  return <div className="site-shell">
    <a className="skip-link" href="#main">Pular para o conteúdo</a>
    <header className="site-header"><Link className="brand" href="/" aria-label="CineGrid, início"><span className="brand-icon" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <span key={i} />)}</span>CineGrid</Link><span className="header-caption">UM DIÁRIO EM PÔSTERES</span></header>
    <main id="main">
      <section className="intro" aria-labelledby="title"><h1 id="title">Sua semana de filmes em <span>uma imagem.</span></h1><p className="intro-description">Transforme seu diário do Letterboxd em uma colagem de pôsteres. Escolha o recorte, gere e guarde.</p></section>
      <CollageForm />
    </main>
    <Credits />
  </div>;
}
