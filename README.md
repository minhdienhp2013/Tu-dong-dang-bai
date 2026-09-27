# Auto Social Minh Điến — v0.2.4

Ứng dụng Windows desktop local-first để:

**Ảnh local → AI viết caption → kiểm tra/chỉnh sửa → lên lịch → điều khiển Google Chrome đăng lên Facebook cá nhân.**

> Đây là browser automation, **không phải Facebook Graph API**. Facebook thay đổi giao diện có thể cần cập nhật selector. Ứng dụng không vượt CAPTCHA/checkpoint/2FA; khi gặp xác minh phải dừng để người dùng xử lý thủ công.

## Trạng thái kiến trúc đã chốt

- Windows desktop.
- Electron + TypeScript.
- Playwright dùng **Google Chrome thật** qua `channel: 'chrome'`.
- SQLite local.
- Ảnh nằm nguyên trên máy người dùng.
- DeepSeek API hoặc Ollama local.
- Facebook cá nhân trước.
- Không cần Cloudflare/Firebase cho luồng chính.
- Không lưu username/password Facebook trong source hoặc database.

## Kho ảnh local

Ví dụ:

```text
D:\AUTO SOCIAL\
├─ Tủ sồi\
│  ├─ 01.jpg
│  ├─ 02.jpg
│  ├─ 03.webp
│  └─ thongtin.txt
├─ Bàn học cao su 1m\
│  ├─ 01.jpg
│  └─ 02.png
└─ _phong-cach\
   └─ bai-mau.txt
```

Hỗ trợ: `jpg`, `jpeg`, `png`, `webp`.

- Tên thư mục = tên mặt hàng.
- `thongtin.txt` là dữ kiện thật AI được phép dùng.
- Thư mục bắt đầu bằng `_` không được coi là sản phẩm.
- Ảnh gốc không bị sửa/xóa khi quản lý trong app.

## Chế độ TEST và AUTO

### TEST — mặc định, nên dùng trước

App tự:
- chọn sản phẩm;
- chọn ảnh;
- gọi AI;
- mở Facebook;
- mở composer;
- điền caption;
- upload ảnh.

Sau đó **dừng trước nút Đăng** để người dùng tự kiểm tra và bấm Đăng.

### AUTO

Chỉ bật khi TEST đã ổn định. App thực hiện toàn bộ luồng và tự click **Đăng**.

Ở v0.2.1, luồng AUTO cho **trang cá nhân** được siết chặt:
- đi thẳng tới `https://www.facebook.com/me/`;
- chờ composer thật sự mở;
- điền caption;
- upload toàn bộ ảnh;
- chờ nút **Đăng** enabled trước khi click;
- sau click, chờ composer đóng ổn định và kiểm tra không có thông báo lỗi;
- chỉ khi xác nhận được mới ghi `posted`;
- nếu đã click nhưng không xác nhận chắc chắn, ghi `uncertain / POST_UNCERTAIN`, giữ Chrome mở để kiểm tra và **không retry tự động**.

## Chống đăng trùng

Ứng dụng có nhiều lớp bảo vệ:

- Electron single-instance lock: không cho chạy hai instance cùng lúc.
- SQLite `scheduled_jobs.job_key` unique: một khung giờ chỉ claim một lần.
- Trạng thái job: `pending → preparing → posting → posted / prepared / failed / uncertain`.
- Nếu app crash khi đang `posting`, lần mở sau chuyển thành `uncertain` và **không tự đăng lại**.
- AUTO retry chỉ cho `NETWORK_ERROR`.
- Tối đa 2 retry: khoảng 30 giây và 2 phút.
- Không retry tự động với UI change, login, CAPTCHA/checkpoint, upload lỗi hoặc lỗi không rõ.

## Scheduler

Scheduler dùng **giờ local của Windows**.

Ví dụ:

```text
08:00, 12:00, 19:30
```

Khi app bị sleep rồi thức dậy, slot trong cửa sổ trễ ngắn vẫn được claim một lần nhờ job key. Nếu job đã claim rồi thì không chạy lại.

Có thể:
- bật/tắt tự động;
- pause/resume scheduler;
- “Đăng bài tiếp theo” ngay;
- chạy nền ở system tray;
- tự mở cùng Windows;
- khởi động minimized.

## Facebook session

App dùng browser profile riêng trong `app.getPath('userData')/facebook-browser-profile`.

Lần đầu:
1. Mở Cài đặt.
2. Bấm **Mở Facebook để đăng nhập**.
3. Đăng nhập thủ công bằng chính chủ tài khoản.
4. Đóng cửa sổ Chrome.
5. Bấm **Kiểm tra trạng thái**.

Status:
- 🟢 Đã đăng nhập
- 🟡 Cần kiểm tra
- 🔴 Chưa đăng nhập

Các trường hợp CAPTCHA/checkpoint/2FA/session expired được coi là cần kiểm tra thủ công.

## AI caption

AI nhận:
- tên sản phẩm;
- `thongtin.txt`;
- bài mẫu phong cách;
- thông tin sản phẩm/ghi chú ảnh trong Content Manager;
- các ví dụ caption AI đã bị người dùng sửa trước đây.

Nguyên tắc cứng:
- không bịa giá;
- không bịa chất liệu;
- không bịa kích thước;
- không bịa bảo hành/xuất xứ/khuyến mại;
- thiếu dữ liệu thì viết ngắn;
- không nhắc đến AI.

### Caption learning

Khi caption AI bị sửa trước khi đăng, app lưu:
- bản AI gốc;
- bản người dùng dùng thật.

Những cặp sửa gần đây được đưa lại vào prompt để AI bám dần phong cách thực tế.

### Multi-style

Tab **Phong cách** hỗ trợ:
- tạo style;
- sửa style;
- bật/tắt style;
- đặt một style mặc định.

## Content Manager

Trong cùng một app có:
- category / sub-category;
- product;
- product info;
- nhiều ảnh;
- ghi chú từng ảnh;
- bật/tắt ảnh;
- thứ tự ảnh;
- AI content;
- manual content;
- hashtag;
- lịch đăng;
- trạng thái;
- lịch sử.

## Dashboard

Hiển thị:
- Facebook status;
- TEST/AUTO;
- bật/tắt tự động;
- scheduler paused/running;
- bài tiếp theo;
- sản phẩm dự kiến;
- số mặt hàng;
- số ảnh;
- số bài đăng hôm nay;
- số lỗi hôm nay.

## History & logging

History có:
- thời gian;
- mặt hàng;
- caption;
- ảnh;
- mode;
- status;
- error code.

Local log ghi các event chính như:
- app start;
- schedule trigger;
- AI start/success;
- product selected;
- Facebook opened;
- image upload;
- post success/failure.

Log **không cố ý ghi API key, cookie, token hoặc session**.

## Error code

Các lỗi chính:
- `NETWORK_ERROR`
- `AI_ERROR`
- `FACEBOOK_UI_CHANGED`
- `NOT_LOGGED_IN`
- `SECURITY_CHECK`
- `UPLOAD_ERROR`
- `POST_UNCERTAIN`
- `UNKNOWN`

## Chạy development

Yêu cầu:
- Windows 10/11
- Node.js 24.x
- Google Chrome

```bash
npm install
npm run dev
```

## Build installer Windows

```bash
npm install
npm run build
```

Kết quả nằm trong:

```text
release/
  Auto Social Minh Dien Setup 0.2.4.exe
```

Build dùng `--publish never`, nên không cần `GH_TOKEN` chỉ để đóng gói installer.

## Dữ liệu local / bảo mật

Không commit:
- `.env`
- API key
- cookie/session Facebook
- Chrome profile
- SQLite thật
- logs
- node_modules
- release

Các đường dẫn này đã được chặn trong `.gitignore`.

## Quy trình nghiệm thu trước AUTO

1. Chọn kho ảnh local.
2. TEST scan nhiều folder.
3. Kiểm tra `thongtin.txt`.
4. TEST AI caption với sản phẩm đủ/thiếu thông tin.
5. Kiểm tra ảnh preview và thứ tự ảnh.
6. Đăng nhập Facebook qua Chrome profile riêng.
7. TEST ít nhất 10 bài: phải dừng trước nút Đăng.
8. Test lịch 1 slot và xác nhận không chạy hai lần.
9. Test mất mạng → retry có giới hạn.
10. Test logout/checkpoint → phải dừng, không retry tự động.
11. Đóng/mở app trong lúc job posting test → trạng thái phải thành `uncertain`, không đăng lại.
12. Chỉ khi các mục trên ổn định mới chuyển sang AUTO.

## CI

GitHub Actions chạy trên Windows với **Node.js 24**:
- `npm install`;
- kiểm tra `better-sqlite3` load được thật trên Node 24;
- TypeScript compile;
- build NSIS installer;
- upload installer thành artifact để tải test.

**Không merge vào `main` nếu TypeScript/build Windows còn đỏ.**


## Phạm vi ưu tiên hiện tại

Bản này **chỉ hoàn thiện đăng Facebook trang cá nhân trước**.

Chưa triển khai trong nhánh này:
- đăng hội nhóm;
- đăng Fanpage;
- lịch calendar cả tháng;
- social network khác.

Các phần đó được giữ lại cho bước sau để không làm tăng rủi ro khi luồng trang cá nhân chưa được nghiệm thu thực tế.


## Node.js 24

Từ v0.2.2:
- runtime development chuẩn là **Node.js 24.x**;
- SQLite dùng trực tiếp module tích hợp `node:sqlite`, không còn phụ thuộc `better-sqlite3`;
- không còn bước native rebuild bằng node-gyp khi `npm install`;
- vì vậy máy Windows không cần Visual Studio C++ Build Tools chỉ để cài/chạy ứng dụng;
- Electron 38.8.6 dùng Node 22.22.0, đã có sẵn `node:sqlite`;
- CI Windows kiểm tra SQLite cả trên Node 24 của máy build và Node tích hợp bên trong Electron trước khi đóng gói.

Nếu trước đó đã cài bản dùng `better-sqlite3`, hãy xóa `node_modules` và `package-lock.json` rồi chạy lại `npm install`.


## Đăng nhập Facebook bằng trình duyệt thật

Từ v0.2.3, nút **Mở Facebook để đăng nhập** không dùng Playwright.

- App mở Microsoft Edge thật trước; nếu không có thì dùng Google Chrome.
- Dùng profile riêng của Auto Social để session/cookie được giữ ổn định.
- Người dùng tự đăng nhập và tự xử lý CAPTCHA/checkpoint/2FA nếu Facebook yêu cầu.
- Sau khi đăng nhập/xác minh xong, đóng toàn bộ cửa sổ trình duyệt đó rồi mới bấm **Kiểm tra trạng thái**.
- TEST/AUTO chỉ chạy sau khi session đã được tạo thủ công.
- App không tự vượt hoặc né cơ chế xác minh của Facebook.


## Sản phẩm trong Content Manager dùng trực tiếp cho TEST/AUTO

Từ v0.2.4, nút **Tạo bài** không còn chỉ phụ thuộc vào thư mục kho ảnh.

Nguồn sản phẩm theo thứ tự:
1. Sản phẩm đang bật trong tab **Sản phẩm**, có ít nhất một ảnh đang bật và file ảnh còn tồn tại trên máy.
2. Các thư mục sản phẩm trong kho local chưa trùng tên với sản phẩm đã quản lý trong app.

Vì vậy:
- thêm sản phẩm trong app;
- thêm ảnh cho sản phẩm;
- bật trạng thái sản phẩm/ảnh;
- có thể TEST ngay, không cần tạo thêm thư mục riêng;
- scheduler cũng có thể chạy từ Content Manager dù chưa cấu hình rootFolder.

Nếu một sản phẩm trong Content Manager trùng tên với thư mục local, bản trong Content Manager được ưu tiên để tránh chọn trùng.
