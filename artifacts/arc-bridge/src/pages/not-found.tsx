import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#0C1220] flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-white">404</h1>
        <p className="text-slate-400">Page not found</p>
        <Link href="/" className="text-[#4F9CF9] hover:underline text-sm">
          Back to Bridge
        </Link>
      </div>
    </div>
  );
}
