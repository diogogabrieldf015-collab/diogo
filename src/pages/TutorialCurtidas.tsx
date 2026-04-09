export default function TutorialCurtidas() {
  return (
    <div className="min-h-[100dvh] bg-background text-foreground px-4 py-10">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <h1 className="text-2xl font-black tracking-tight">Como copiar o link do post (Curtidas)</h1>
        <p className="text-sm text-muted-foreground">
          Se o vídeo não aparecer, coloque o arquivo <span className="font-semibold text-foreground">Likes.mp4</span> dentro
          da pasta <span className="font-semibold text-foreground">public/</span> do projeto.
        </p>

        <div className="rounded-xl border border-border bg-card p-3">
          <video
            src="/Likes.mp4"
            controls
            playsInline
            className="w-full rounded-lg bg-black"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Caminho esperado: <span className="font-mono">public/Likes.mp4</span>
        </p>
      </div>
    </div>
  );
}

