export function healthzResponse(): Response {
  return new Response("ok", { status: 200 });
}
