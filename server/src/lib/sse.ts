/** Server-Sent Events 응답 (기획서 §6.3: 상태와 검증된 최종 답변만 보낸다) */
export function sseResponse(run: (send: (event: string, data: unknown) => void) => Promise<void>, headers?: Headers): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await run(send);
      } finally {
        controller.close();
      }
    },
  });
  const h = new Headers(headers);
  h.set('Content-Type', 'text/event-stream; charset=utf-8');
  h.set('Cache-Control', 'no-cache, no-transform');
  h.set('X-Accel-Buffering', 'no');
  return new Response(stream, { status: 200, headers: h });
}
