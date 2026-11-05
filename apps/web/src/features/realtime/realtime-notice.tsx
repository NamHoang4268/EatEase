'use client';
import type { RealtimeStatus } from './use-realtime';

export function RealtimeNotice({
  status,
  reconnect,
}: {
  status: RealtimeStatus;
  reconnect: () => void;
}) {
  if (status === 'disabled' || status === 'connected') return null;
  return (
    <p role="status">
      {status === 'connecting'
        ? 'Đang kết nối cập nhật trực tiếp…'
        : 'Cập nhật trực tiếp đang gián đoạn. Bạn vẫn có thể làm mới thủ công.'}
      {status === 'offline' ? (
        <button className="text-button" type="button" onClick={reconnect}>
          Kết nối lại
        </button>
      ) : null}
    </p>
  );
}
