import type { SeatUpdateEvent } from '../types';

type SeatUpdatePayload = NonNullable<SeatUpdateEvent['payload']>;
type SeatUpdateHandler = (payload: SeatUpdatePayload) => void;

type Options = {
  clientId: string;
  onUpdate: SeatUpdateHandler;
  onStatus?: (text: string) => void;
};

export function subscribeSeatUpdates({ clientId, onUpdate, onStatus }: Options): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let retries = 0;

  const connect = () => {
    if (stopped) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/ws?client_id=${encodeURIComponent(clientId)}`;
    socket = new WebSocket(url);

    socket.onopen = () => {
      retries = 0;
      onStatus?.('connected');
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as SeatUpdateEvent;
        if (message.event === 'seat_update' && message.payload) {
          onUpdate(message.payload);
        }
      } catch (error) {
        console.error('WS parse error', error);
      }
    };

    socket.onclose = () => {
      if (stopped) return;
      retries += 1;
      const delay = Math.min(5000, 1000 * retries);
      onStatus?.(`reconnecting in ${delay / 1000}s`);
      setTimeout(connect, delay);
    };

    socket.onerror = () => {
      onStatus?.('connection error');
    };
  };

  connect();

  return () => {
    stopped = true;
    socket?.close();
  };
}
