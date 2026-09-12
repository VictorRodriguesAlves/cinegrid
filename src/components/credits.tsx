export function Credits() {
  return <footer className="credits" aria-labelledby="credits-heading">
    <div className="credits-brand"><a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
      {/* Official unmodified vector asset, not a poster or an optimized image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tmdb.svg" alt="TMDB" width="84" height="11" />
    </a><span id="credits-heading">Dados e pôsteres</span></div>
    <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
    <p>Projeto independente, sem afiliação com o Letterboxd.</p>
  </footer>;
}
