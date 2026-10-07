export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-dashed border-secondary px-6 py-12 text-center">
      <p className="text-sm font-medium text-secondary">{title}</p>
      <p className="mt-1 text-sm text-tertiary">Not built yet.</p>
    </div>
  );
}
