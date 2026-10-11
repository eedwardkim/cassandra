import { Dossier } from "./Dossier";

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <Dossier symbol={decodeURIComponent(symbol)} />;
}
