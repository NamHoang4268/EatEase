# UI/UX design guidelines

Status: **APPROVED design baseline**

Tài liệu này là authoritative visual and interaction guideline cho frontend EatEase. Nó định hướng presentation và usability; không thay đổi [business rules](../product/business-rules.md), [permissions](../architecture/permissions.md), [security controls](../architecture/security.md), [API contracts](../architecture/api-contracts.md) hoặc [state transitions](../architecture/state-machines.md).

## Design identity

**Modern Editorial SaaS — Soft Yellow & Neutral**

EatEase phải tạo cảm giác modern, refined, calm và professional:

- Light mode sáng, sạch và thoáng.
- Dark mode thanh lịch, dễ chịu và có hierarchy rõ.
- Visual polish đến từ composition, typography, imagery, whitespace và consistency thay vì decoration dư thừa.
- Border radius tương đối nhỏ, border tinh tế và shadow tiết chế.
- Usability, readability và operational efficiency luôn ưu tiên hơn visual novelty.

Tránh giao diện quá bo tròn hoặc playful, heavy gradient, shadow nặng, animation không cần thiết, dashboard generic và các pattern không nhất quán.

## Authoritative references

Các reference sau định hướng visual language, không định nghĩa business functionality:

1. [Customer — Cravk Food Details & Cart Mobile App UI](https://dribbble.com/shots/26943556-Cravk-Food-Details-Cart-Mobile-App-UI): food imagery, editorial hierarchy, typography, whitespace và premium mobile presentation.
2. [Management — Modern Food SaaS Admin Panel](https://dribbble.com/shots/27038589-UI-UX-Design-for-Modern-Food-SaaS-Admin-Panel): sidebar navigation, page composition, tables, cards và dashboard information hierarchy.
3. [Operations — Restaurant POS System Dashboard](https://dribbble.com/shots/27041794-Restaurant-POS-System-Dashboard): fast operational layout, scannable order cards, clear statuses và efficient actions.

Nếu reference tạm thời không truy cập được, tiếp tục theo các đặc tính đã ghi trong tài liệu này; không tự thay bằng một visual style khác. Mọi nội dung, action và state vẫn phải lấy từ product/architecture documents authoritative.

## Experience areas

### Customer experience

- Thiết kế mobile-first cho hành trình scan QR, browse menu, activation, cart và explicit order submission.
- Dùng food imagery chất lượng cao, editorial headings có chọn lọc và whitespace rộng để tạo premium presentation.
- Menu item name, authoritative price, availability, options và cart action phải dễ tìm và dễ hiểu.
- Primary cart/order action cần nổi bật nhưng không che nội dung hoặc gây accidental submission.
- Waiting, rejoin, session-expired và recovery states phải giải thích rõ; không làm UI ngụ ý rằng activation tự submit cart.
- Không hy sinh navigation, performance hoặc accessibility để tăng decoration.

### Management experience

- Ưu tiên desktop/tablet với responsive behavior phù hợp cho màn hình nhỏ hơn.
- Dùng navigation, page header, filters, cards, tables và summary regions nhất quán.
- Visual hierarchy phải giúp staff phân biệt overview, operational state và action cần xử lý.
- Dense data được trình bày bằng table/list thích hợp; không biến mọi dữ liệu thành card.
- Permission-sensitive actions chỉ hiển thị khi hữu ích cho UX, nhưng backend authorization vẫn là security boundary.

### POS and kitchen operations

- Tối ưu speed, readability, touch interaction và fast decision-making trong môi trường bận.
- Order/item identity, station, elapsed context và status phải scan nhanh, không phụ thuộc duy nhất vào màu.
- Primary operational action phải rõ và khó bấm nhầm; destructive hoặc irreversible action cần confirmation tương xứng rủi ro.
- Queue ordering và state transition phải dễ dự đoán; visual design không được tạo transition ngoài approved lifecycle.
- Ưu tiên stable layout để realtime update không làm staff mất vị trí hoặc context.

## Color system

Component phải dùng semantic tokens; không hardcode palette value rải rác trong component. Primary yellow luôn dùng foreground tối có đủ contrast.

### Light mode

| Semantic token | Value     | Intended use                                |
| -------------- | --------- | ------------------------------------------- |
| Primary        | `#F5D76E` | Primary actions, selected emphasis          |
| Primary hover  | `#EAC653` | Hover/pressed emphasis                      |
| Soft yellow    | `#FEF3C7` | Highlighted background, subtle callout      |
| Background     | `#F8FAFC` | Application/page background                 |
| Surface        | `#FFFFFF` | Cards, panels, menus and elevated surfaces  |
| Text           | `#0F172A` | Primary text and primary-button foreground  |
| Muted text     | `#64748B` | Secondary information                       |
| Border         | `#E2E8F0` | Dividers, controls and subtle card outlines |

### Dark mode

| Semantic token | Value     | Intended use                                |
| -------------- | --------- | ------------------------------------------- |
| Primary        | `#F5D76E` | Primary actions, selected emphasis          |
| Primary hover  | `#FDE68A` | Hover/pressed emphasis                      |
| Soft yellow    | `#422006` | Highlighted background, subtle callout      |
| Background     | `#0B1220` | Application/page background                 |
| Surface        | `#151F30` | Cards, panels, menus and elevated surfaces  |
| Text           | `#E2E8F0` | Primary text                                |
| Muted text     | `#94A3B8` | Secondary information                       |
| Border         | `#334155` | Dividers, controls and subtle card outlines |

Success, warning, error và informational colors có thể được định nghĩa khi feature thực sự cần. Chúng phải:

- Có semantic role ổn định trong cả hai themes.
- Đủ contrast và phân biệt được mà không chỉ dựa vào hue.
- Không tạo competing brand palette.
- Được định nghĩa tập trung trước khi reuse, không thêm ad hoc trong từng component.

## Typography and iconography

- Dùng clean, modern sans-serif cho navigation, form, table, status và operational content.
- Editorial type treatment chỉ dùng có chọn lọc cho customer-facing heading hoặc featured content; body/action text vẫn ưu tiên readability.
- Tạo hierarchy bằng size, weight, line height và whitespace nhất quán; không dùng quá nhiều font family hoặc weight.
- Numeric price, quantity và operational metadata phải dễ scan và không bị decorative typography làm mờ.
- Dùng một consistent icon family. Icon action cần accessible label hoặc đi kèm visible text khi ý nghĩa không hiển nhiên.
- Không dùng icon, màu hoặc typography để thay thế nội dung trạng thái bắt buộc.

Exact font family và delivery strategy được chọn trong frontend implementation task phù hợp, dựa trên readability, Vietnamese support, performance và licensing; không tự ý đổi design identity.

## Spacing, shape and elevation

- Dùng spacing scale theo increment `4px`; ưu tiên các bước `4`, `8`, `12`, `16`, `24`, `32`, `48` và `64px` thay vì arbitrary values.
- Border radius thường trong khoảng `4–8px`. Chỉ dùng shape khác khi có semantic hoặc interaction reason rõ ràng.
- Ưu tiên subtle border và surface contrast hơn heavy shadow.
- Giữ alignment, internal padding và vertical rhythm nhất quán giữa card, form, list và table.
- Whitespace là một phần của hierarchy; không nén customer content quá mức hoặc kéo giãn operational layout không cần thiết.

## Bento grid and editorial composition

Bento là preferred composition pattern, không phải layout bắt buộc cho mọi page.

### Principles

- Dùng asymmetric grid với card có kích thước khác nhau để tạo hierarchy rõ.
- Kết hợp một featured region lớn với supporting cards nhỏ hơn.
- Giữ spacing, alignment, border và restrained radius nhất quán.
- Customer Bento ưu tiên high-quality food imagery và refined typography.
- Composition phải cân bằng và có reading order rõ, không trở thành decorative mosaic phức tạp.

### Appropriate use

- Featured dishes, chef recommendations, best sellers và menu category highlights.
- Restaurant introduction hoặc promotion chỉ khi nội dung đó thực sự thuộc approved product scope.
- Management overview, key metrics, charts và operational summaries.

### Do not use

- Checkout, form, dense table, order queue hoặc task-oriented workflow cần reading/action order tuyến tính.
- Page không có content hierarchy thực sự hoặc phải tạo fake promotion/business feature để lấp grid.
- Layout có card-size variation quá mức, confusing reading order hoặc horizontal overflow.

Trên màn hình nhỏ, Bento phải chuyển thành grid/stack predictable theo content priority và DOM reading order. Không dùng visual reordering làm keyboard/screen-reader order sai lệch.

## Responsive behavior

- Customer UI bắt đầu từ mobile viewport rồi progressively enhance.
- Management UI bắt đầu từ desktop/tablet needs nhưng vẫn có usable fallback trên màn hình hẹp.
- POS/kitchen layout theo target operational device và ưu tiên touch interaction.
- Breakpoint được chọn theo content pressure, không theo tên thiết bị tùy ý.
- Không có horizontal page overflow. Dense table có thể dùng deliberate contained scrolling hoặc alternative compact view nếu vẫn giữ context.
- Navigation, primary action và critical status không được biến mất ngoài viewport mà không có accessible alternative.

## Interaction states and motion

Mọi interactive component liên quan phải có state rõ cho default, hover, focus-visible, active, disabled và loading. Feature/data view phải thiết kế empty, error, success và unavailable states phù hợp.

- Loading state không được làm người dùng hiểu nhầm mutation đã thành công.
- Disabled action phải có lý do dễ hiểu khi workflow cần giải thích.
- Error message phải actionable và không expose secret hoặc sensitive security detail.
- Animation ngắn, purposeful và không cản thao tác; tránh layout shift và decorative motion lặp lại.
- Tôn trọng `prefers-reduced-motion` và cung cấp non-motion equivalent.

## Accessibility

- Hỗ trợ keyboard navigation và logical focus order.
- Luôn có visible focus indicator đủ contrast trong light/dark mode.
- Form control có accessible name, instruction và error association.
- Text, icon, status và interactive control phải đạt contrast phù hợp; yellow background dùng dark foreground.
- Không truyền đạt status chỉ bằng màu; kết hợp label, icon, shape hoặc text.
- Touch target quan trọng nên đủ rộng cho thao tác ổn định, đặc biệt ở customer, POS và kitchen surfaces.
- Food image có alt text theo mục đích; decorative image dùng empty alt phù hợp.
- Heading và landmark structure phải phản ánh content hierarchy, kể cả khi Bento thay đổi visual size.

## Themes

- Light mode là default visual direction.
- Light/dark dùng cùng semantic roles và interaction meaning; dark mode không chỉ đảo màu cơ học.
- Theme phải được xem xét từ khi thiết kế token/component, nhưng theme toggle không được tự động thêm nếu task chưa yêu cầu.
- Không trì hoãn core business flow chỉ để hoàn thiện theme capability ngoài scope.

## Implementation discipline

- Xây reusable component incrementally khi feature thật sự cần; không tạo design system package lớn hoặc component inventory speculative.
- Mỗi component consume semantic tokens và shared primitives đã được phê duyệt thay vì duplicate arbitrary styles.
- Không cài UI library, icon set, font package hoặc animation dependency nếu task chưa authorize.
- UI guard, hidden button hoặc disabled state không thay thế server-side permission/resource checks.
- Không thay đổi business rule, role capability, API contract hoặc state machine để khớp mockup/reference.
- Không invent promotion, metric, chart, menu data hoặc workflow chỉ để hoàn thiện composition.
- Khi một routine design detail chưa được ghi rõ, Codex có thể tự quyết định nếu consistent với guideline này và không tạo product/architecture decision mới.
- Style direction khác, competing palette hoặc material visual change cần explicit owner approval.

## Frontend review checklist

- Surface được xác định đúng: customer, management hay operations.
- Layout phù hợp task; Bento chỉ được dùng khi cải thiện hierarchy.
- Semantic tokens hoạt động trong light và dark mode.
- Typography, spacing, radius, border và icons nhất quán.
- Mobile/desktop/touch behavior phù hợp target surface và không overflow.
- Loading, empty, error, success, disabled và focus states đã được xem xét.
- Keyboard, labels, contrast, reduced motion và reading order được kiểm tra.
- UI không thay đổi hoặc che khuất approved business/security behavior.
- Component chỉ được abstract/reuse theo nhu cầu thực tế.
