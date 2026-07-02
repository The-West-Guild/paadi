export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main>Pay {token}</main>;
}
