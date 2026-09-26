# Auto Social Minh Điến — MVP 0.1

Ứng dụng Windows độc lập theo luồng:

**Thư mục ảnh local → AI tạo caption theo phong cách đã duyệt → đặt lịch → tự động điều khiển Chrome đăng lên Facebook cá nhân.**

> Đây là browser automation, không phải API xuất bản chính thức của Meta cho profile cá nhân. Facebook đổi giao diện có thể cần cập nhật selector. Ứng dụng không vượt CAPTCHA/checkpoint; khi gặp xác minh phải dừng để người dùng xử lý thủ công.

> Repo đang public: tuyệt đối không commit API key, cookie Facebook, Chrome profile, file `.env`, SQLite hoặc dữ liệu đăng nhập. Các loại dữ liệu local này đã được chặn trong `.gitignore`.

## 1) Cấu trúc kho ảnh

Ví dụ:

```text
D:\AUTO SOCIAL\
├─ Tủ sồi\
│  ├─ 01.jpg
│  ├─ 02.jpg
│  ├─ 03.jpg
│  └─ thongtin.txt        (không bắt buộc)
├─ Bàn học cao su 1m\
│  ├─ 01.jpg
│  └─ 02.jpg
└─ _phong-cach\
   └─ bai-mau.txt         (không bắt buộc, dán 20-50 bài cũ vào đây)
```

Tên thư mục được coi là tên mặt hàng. `thongtin.txt` chỉ chứa những dữ kiện thật mà AI được phép dùng, ví dụ giá/kích thước/chất liệu nếu anh muốn AI nhắc đến.

## 2) Chạy thử từ source

Yêu cầu: Windows 10/11, Node.js 20+, Google Chrome. Ứng dụng dùng Chrome đã cài trên máy, không tải Chromium riêng.

```bash
npm install
npm run dev
```

Lần đầu:
1. Chọn `Kho ảnh`.
2. Chọn DeepSeek hoặc Ollama.
3. Bấm **Mở Facebook để đăng nhập**.
4. Đăng nhập Facebook thủ công trong Chrome vừa mở.
5. Đóng Chrome sau khi đăng nhập xong.
6. Bấm **AI tạo bài tiếp theo** → kiểm tra → **Đăng ngay**.

## 3) AI

### DeepSeek
Nhập API key ngay trong ứng dụng. Key được lưu trong thư mục dữ liệu ứng dụng trên máy, không gửi lên server của phần mềm này.

### Ollama local
Chọn `Ollama local`, URL mặc định `http://127.0.0.1:11434`, sau đó chọn model đang có trên máy.

## 4) Tự động đăng

Cài các giờ như:

```text
08:00, 12:00, 19:30
```

Bật `Tự động đăng`. Ứng dụng chạy thì cứ đến giờ sẽ:
- chọn mặt hàng đủ điều kiện;
- ưu tiên ảnh chưa dùng;
- tạo caption;
- mở Chrome;
- đăng bài;
- lưu lịch sử SQLite.

## 5) Quy tắc an toàn

- Không lưu username/password Facebook trong code/database.
- Dùng Chrome profile riêng của ứng dụng.
- Không vượt CAPTCHA, checkpoint hoặc xác minh tài khoản.
- Không tự bịa giá, chất liệu, kích thước, bảo hành.
- Khi Facebook đổi giao diện và selector không còn khớp, app báo lỗi thay vì click bừa.

## 6) Build .exe

Trên Windows:

```bash
npm install
npm run build
```

File cài đặt sẽ nằm trong thư mục `dist/` do electron-builder tạo.

## 7) Dữ liệu local

SQLite và config nằm trong `app.getPath('userData')` của Electron. Ảnh vẫn nằm nguyên trong kho ảnh mà anh chọn.

## 8) MVP hiện có

- Chọn kho ảnh local.
- Quét thư mục mặt hàng.
- `thongtin.txt` cho dữ kiện bổ sung.
- `_phong-cach/bai-mau.txt` cho bài mẫu.
- DeepSeek hoặc Ollama.
- AI caption chống bịa thông tin.
- Ưu tiên ảnh chưa sử dụng.
- Khoảng ngày chống lặp mặt hàng.
- Lịch nhiều giờ mỗi ngày.
- Chrome persistent profile.
- Đăng ảnh + caption lên Facebook qua Playwright.
- Dừng khi phát hiện dấu hiệu CAPTCHA/checkpoint/xác minh.
- SQLite lưu lịch sử thành công/thất bại và ảnh đã dùng.

## 9) Việc nên làm ở bản 0.2

- Preview ảnh dạng thumbnail thật.
- Nhiều phong cách caption chọn bằng dropdown.
- Học từ phần caption người dùng sửa trước khi đăng.
- Retry có giới hạn khi mạng lỗi.
- Khóa chạy để không đăng trùng khi ứng dụng mở hai phiên.
- Thông báo Windows khi đăng thành công/thất bại.
- Bộ selector Facebook cập nhật từ file cấu hình để sửa mà không cần build lại app.
