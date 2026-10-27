'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDraftItem,
  calculateDraftSubtotal,
  changeDraftQuantity,
  formatVnd,
  removeDraftItem,
  type DraftCartLine,
} from './draft-cart';
import type { PublicMenu, PublicMenuItem, PublicTableContext } from './public-menu.types';

type LoadState =
  | { status: 'loading' }
  | { status: 'invalid' }
  | { status: 'error' }
  | { status: 'ready'; table: PublicTableContext; menu: PublicMenu };

const availabilityCopy = {
  AVAILABLE: 'Sẵn sàng để xem thực đơn',
  BROWSE_ONLY: 'Bàn đang được sử dụng · Chỉ xem thực đơn',
  UNAVAILABLE: 'Bàn hiện chưa sẵn sàng · Chỉ xem thực đơn',
} as const;

export function PublicMenuExperience({ publicId }: { publicId: string }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [view, setView] = useState<'menu' | 'cart'>('menu');
  const [cart, setCart] = useState<DraftCartLine[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    const encodedPublicId = encodeURIComponent(publicId);
    void Promise.all([
      fetch(`/api/v1/public/tables/${encodedPublicId}`, { signal: controller.signal }),
      fetch(`/api/v1/public/menu?tablePublicId=${encodedPublicId}`, {
        signal: controller.signal,
      }),
    ])
      .then(async ([tableResponse, menuResponse]) => {
        if (tableResponse.status === 404) {
          setLoadState({ status: 'invalid' });
          return;
        }
        if (!tableResponse.ok || !menuResponse.ok) {
          setLoadState({ status: 'error' });
          return;
        }

        const [tablePayload, menuPayload] = (await Promise.all([
          tableResponse.json(),
          menuResponse.json(),
        ])) as [{ data: PublicTableContext }, { data: PublicMenu }];
        setLoadState({ status: 'ready', table: tablePayload.data, menu: menuPayload.data });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setLoadState({ status: 'error' });
        }
      });

    return () => controller.abort();
  }, [publicId, reloadToken]);

  const itemCount = useMemo(() => cart.reduce((total, line) => total + line.quantity, 0), [cart]);
  const subtotal = useMemo(() => calculateDraftSubtotal(cart), [cart]);

  if (loadState.status === 'loading') {
    return (
      <main className="customer-shell customer-state" aria-busy="true">
        <span className="state-mark" aria-hidden="true">
          EE
        </span>
        <p className="eyebrow">EatEase</p>
        <h1>Đang mở thực đơn…</h1>
        <p>Chúng tôi đang kiểm tra thông tin bàn và chuẩn bị món cho bạn.</p>
      </main>
    );
  }

  if (loadState.status === 'invalid') {
    return (
      <main className="customer-shell customer-state">
        <span className="state-mark" aria-hidden="true">
          ?
        </span>
        <p className="eyebrow">Không tìm thấy bàn</p>
        <h1>Mã QR này không còn hợp lệ</h1>
        <p>Vui lòng kiểm tra lại mã tại bàn hoặc nhờ nhân viên hỗ trợ.</p>
      </main>
    );
  }

  if (loadState.status === 'error') {
    return (
      <main className="customer-shell customer-state">
        <span className="state-mark" aria-hidden="true">
          !
        </span>
        <p className="eyebrow">Kết nối gián đoạn</p>
        <h1>Chưa thể tải thực đơn</h1>
        <p>Hãy kiểm tra kết nối và thử lại. Giỏ nháp trên trang sẽ không tự gửi đi.</p>
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setLoadState({ status: 'loading' });
            setReloadToken((value) => value + 1);
          }}
        >
          Thử lại
        </button>
      </main>
    );
  }

  const menuItems = loadState.menu.categories.flatMap((category) => category.items);
  const canAddItems = loadState.table.availability !== 'UNAVAILABLE';

  const addItem = (item: PublicMenuItem) => {
    if (canAddItems) {
      setCart((current) => addDraftItem(current, item));
    }
  };

  return (
    <main className="customer-shell">
      <header className="menu-hero">
        <div>
          <p className="eyebrow">{loadState.table.locationName}</p>
          <h1>{loadState.table.restaurantName}</h1>
          <p className="hero-copy">Khám phá thực đơn tại bàn {loadState.table.tableLabel}.</p>
        </div>
        <aside className="table-context" aria-label="Thông tin bàn">
          <span className="table-number">{loadState.table.tableLabel}</span>
          <span>Bàn · tối đa {loadState.table.capacity} khách</span>
          <strong data-availability={loadState.table.availability}>
            {availabilityCopy[loadState.table.availability]}
          </strong>
        </aside>
      </header>

      <div className="draft-notice" role="note">
        <strong>Đây là giỏ nháp trên thiết bị.</strong>
        <span>Chức năng kích hoạt bàn và gửi món chưa khả dụng ở bước này.</span>
      </div>

      <nav className="view-switcher" aria-label="Thực đơn và giỏ nháp">
        <button type="button" aria-pressed={view === 'menu'} onClick={() => setView('menu')}>
          Thực đơn
        </button>
        <button type="button" aria-pressed={view === 'cart'} onClick={() => setView('cart')}>
          Giỏ nháp <span className="count-badge">{itemCount}</span>
        </button>
      </nav>

      {view === 'menu' ? (
        <section aria-labelledby="menu-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Chọn món theo ý bạn</p>
              <h2 id="menu-heading">Thực đơn hôm nay</h2>
            </div>
            {loadState.menu.categories.length > 1 ? (
              <nav className="category-nav" aria-label="Danh mục món">
                {loadState.menu.categories.map((category) => (
                  <a key={category.id} href={`#category-${category.id}`}>
                    {category.name}
                  </a>
                ))}
              </nav>
            ) : null}
          </div>

          {menuItems.length === 0 ? (
            <div className="empty-panel">
              <h3>Thực đơn đang được cập nhật</h3>
              <p>Hiện chưa có món đang phục vụ. Vui lòng hỏi nhân viên để được hỗ trợ.</p>
            </div>
          ) : (
            <div className="menu-categories">
              {loadState.menu.categories.map((category) =>
                category.items.length > 0 ? (
                  <section
                    className="menu-category"
                    id={`category-${category.id}`}
                    key={category.id}
                    aria-labelledby={`category-heading-${category.id}`}
                  >
                    <div className="category-heading">
                      <h3 id={`category-heading-${category.id}`}>{category.name}</h3>
                      <span>{category.items.length} món</span>
                    </div>
                    <div className="menu-grid">
                      {category.items.map((item) => (
                        <article className="menu-card" key={item.id}>
                          <div className="menu-card-copy">
                            <h4>{item.name}</h4>
                            {item.description ? <p>{item.description}</p> : null}
                          </div>
                          <div className="menu-card-action">
                            <strong>{formatVnd(BigInt(item.priceAmount))}</strong>
                            <button
                              type="button"
                              disabled={!item.available || !canAddItems}
                              onClick={() => addItem(item)}
                              aria-label={`Thêm ${item.name} vào giỏ nháp`}
                            >
                              Thêm
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ) : null,
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="cart-panel" aria-labelledby="cart-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Chưa gửi đến nhà hàng</p>
              <h2 id="cart-heading">Giỏ nháp của bạn</h2>
            </div>
            <button className="text-button" type="button" onClick={() => setView('menu')}>
              Thêm món khác
            </button>
          </div>

          {cart.length === 0 ? (
            <div className="empty-panel">
              <h3>Giỏ nháp đang trống</h3>
              <p>Chọn món từ thực đơn để chuẩn bị trước khi tính năng đặt món khả dụng.</p>
              <button className="primary-button" type="button" onClick={() => setView('menu')}>
                Xem thực đơn
              </button>
            </div>
          ) : (
            <>
              <ul className="cart-lines">
                {cart.map((line) => (
                  <li key={line.menuItemId}>
                    <div>
                      <h3>{line.name}</h3>
                      <span>{formatVnd(BigInt(line.unitPriceAmount))} / món</span>
                    </div>
                    <div className="quantity-controls" aria-label={`Số lượng ${line.name}`}>
                      <button
                        type="button"
                        aria-label={`Giảm ${line.name}`}
                        onClick={() =>
                          setCart((current) => changeDraftQuantity(current, line.menuItemId, -1))
                        }
                      >
                        −
                      </button>
                      <output aria-label={`Số lượng hiện tại: ${line.quantity}`}>
                        {line.quantity}
                      </output>
                      <button
                        type="button"
                        aria-label={`Tăng ${line.name}`}
                        onClick={() =>
                          setCart((current) => changeDraftQuantity(current, line.menuItemId, 1))
                        }
                      >
                        +
                      </button>
                    </div>
                    <strong>
                      {formatVnd(BigInt(line.unitPriceAmount) * BigInt(line.quantity))}
                    </strong>
                    <button
                      className="remove-button"
                      type="button"
                      onClick={() =>
                        setCart((current) => removeDraftItem(current, line.menuItemId))
                      }
                    >
                      Xóa
                    </button>
                  </li>
                ))}
              </ul>
              <div className="cart-summary">
                <span>Tạm tính · {itemCount} món</span>
                <strong>{formatVnd(subtotal)}</strong>
                <p>
                  Giá hiển thị chỉ dùng cho giỏ nháp và sẽ được máy chủ kiểm tra lại khi đặt món.
                </p>
                <span className="disabled-order-note">Chưa thể gửi món trong giai đoạn này</span>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
