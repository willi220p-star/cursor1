import { Link } from 'wouter';
import { CircleAlert } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] w-full max-w-md items-center justify-center">
      <div className="panel w-full p-8 text-center">
        <CircleAlert className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
        <h2 className="display mt-3 text-2xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">That address is not part of the studio. Head back to the desk to pick up where you left off.</p>
        <Link href="/" className="btn btn-primary mt-6">Back to the desk</Link>
      </div>
    </div>
  );
}
