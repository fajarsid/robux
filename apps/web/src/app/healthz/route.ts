// Container health probe for Docker. Lives outside /api, which belongs to the backend (ADR-008).
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok', service: 'frontend' });
}
