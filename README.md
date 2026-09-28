# Auto Social Minh Điến — v0.3.5

Ứng dụng Windows desktop để quản lý sản phẩm, ảnh, nội dung và đăng Facebook cá nhân trong **một phần mềm duy nhất**.

## Luồng sử dụng

```text
Danh mục trong app
→ Sản phẩm trong app
→ Thêm ảnh
→ Tạo/viết nội dung
→ TEST
→ AUTO / Lịch đăng
→ Facebook cá nhân
```

Không còn yêu cầu người dùng tự tạo thư mục sản phẩm trên Windows.

## Kho ảnh do ứng dụng quản lý

Khi bấm **Thêm ảnh**:
- người dùng chỉ chọn ảnh từ máy một lần;
- Auto Social sao chép ảnh vào kho nội bộ của ứng dụng;
- database lưu đường dẫn của bản sao do app quản lý;
- sau khi nhập xong, luồng đăng không phụ thuộc vào cấu trúc thư mục thủ công bên ngoài.

Ảnh đã thêm ở các bản cũ sẽ được tự sao chép vào kho nội bộ khi có thể. Nếu file cũ đã bị xóa trước khi nâng cấp, người dùng cần thêm lại ảnh đó.

Kho nội bộ nằm dưới thư mục dữ liệu của ứng dụng trong Windows userData.

## Điều kiện để một sản phẩm được chọn đăng

Sản phẩm phải:
- đang **Hoạt động**;
- có ít nhất 1 ảnh đang bật **Dùng**;
- có ít nhất 1 nội dung trạng thái **Nháp** hoặc **Đã duyệt**;
- không nằm trong thời gian chống lặp mặt hàng;
- có ảnh chưa dùng hoặc đã đủ số ngày cho phép dùng lại.

Nút **Tạo bài thử** sử dụng nội dung đã lưu trong tab **Nội dung**. Nó không đọc `thongtin.txt`, tên thư mục Windows hay file bài mẫu bên ngoài.

## Nội dung AI

Tab **Nội dung** cho phép:
- chọn sản phẩm;
- AI tạo bài bằng DeepSeek hoặc Ollama;
- viết thủ công;
- sửa nội dung;
- duyệt nội dung;
- lưu hashtag.

AI chỉ nhận dữ liệu đã nhập trong app:
- tên sản phẩm;
- mô tả;
- thông tin thật được phép dùng;
- hashtag mặc định;
- ghi chú từng ảnh;
- phong cách đã lưu trong tab **Phong cách**;
- các lần người dùng đã sửa caption trước đây.

## Facebook

- Đăng Facebook cá nhân bằng browser automation.
- Nút đăng nhập mở Edge/Chrome thật để người dùng đăng nhập thủ công.
- Không lưu username/password Facebook.
- Không vượt CAPTCHA/checkpoint/2FA.
- TEST dừng trước nút **Đăng**.
- AUTO chỉ nên bật sau khi TEST ổn định.
- Nếu đã click Đăng nhưng không xác nhận chắc chắn, app ghi trạng thái `uncertain` và không retry tự động.

## Scheduler

- Dùng giờ local của Windows.
- Có chống chạy trùng theo job key.
- Có pause/resume.
- AUTO chỉ retry lỗi mạng, tối đa có giới hạn.
- Không retry tự động với login/security/UI/upload/uncertain.

## Dữ liệu local

SQLite và media đều nằm trong dữ liệu riêng của Auto Social trên máy người dùng.

Không cần:
- Firebase;
- Cloudflare;
- thư mục sản phẩm thủ công;
- `thongtin.txt`;
- `bai-mau.txt`.

## Runtime

- Windows 10/11
- Node.js 24.x để chạy development
- Electron 38
- SQLite tích hợp `node:sqlite`
- Microsoft Edge hoặc Google Chrome

## Chạy development

```powershell
npm.cmd install
npm.cmd run dev
```

## Build installer

```powershell
npm.cmd run build
```

Kết quả:

```text
release/
  Auto Social Minh Dien Setup 0.3.5.exe
```

## Nghiệm thu trước AUTO

1. Tạo danh mục trong app.
2. Tạo sản phẩm và bật **Hoạt động**.
3. Thêm ảnh và giữ ít nhất một ảnh ở trạng thái **Dùng**.
4. Vào **Nội dung**, chọn sản phẩm và tạo/viết ít nhất một bài.
5. Đăng nhập Facebook, đóng browser đăng nhập rồi kiểm tra trạng thái.
6. Giữ **TEST** và thử nhiều lần.
7. Kiểm tra đúng sản phẩm, đúng nội dung, đúng ảnh.
8. Chỉ sau khi ổn định mới bật AUTO.

## Phạm vi hiện tại

Ưu tiên hoàn thiện Facebook **trang cá nhân** trước.

Chưa triển khai:
- hội nhóm;
- Fanpage;
- lịch calendar cả tháng;
- mạng xã hội khác.


## Mở ứng dụng bằng 1 lần bấm

Trong thư mục source có file:

```text
MO_AUTO_SOCIAL.bat
```

Chỉ cần bấm đúp file này.

Launcher sẽ:
- kiểm tra Node.js 24;
- nếu thiếu Electron thì tự cài dependency cần thiết;
- compile TypeScript;
- mở Electron với `--show` để luôn hiện cửa sổ;
- nếu Auto Social đang chạy ẩn dưới system tray, lần mở thứ hai sẽ gọi cửa sổ hiện lại;
- nếu app đã thoát hẳn, launcher mở một phiên mới;
- lỗi launcher được ghi tại `%TEMP%\auto-social-launch.log`.

Lệnh tương đương:

```powershell
npm.cmd run start:visible
```

Cấu hình **Khởi động ẩn xuống tray** không ngăn launcher thủ công hiển thị cửa sổ.


## Sửa vùng nhập nội dung Facebook

Từ v0.3.2, composer Facebook không còn phụ thuộc vào một selector duy nhất.

- Chờ tối đa 15 giây để editor của Facebook dựng xong.
- Hỗ trợ Lexical editor, `role=textbox`, `contenteditable`, `aria-placeholder` và nhãn tiếng Việt/Anh.
- Chọn đúng dialog **Tạo bài viết / Create post** khi Facebook có nhiều dialog.
- Fallback bằng textbox nhìn thấy được trong đúng composer.
- Nếu `fill()` không hoạt động với Lexical editor, app focus và chèn text bằng keyboard của Playwright.
- Lỗi đăng Facebook trên UI được rút gọn, không còn chuỗi `Error invoking remote method...` khó đọc.


## Sửa upload ảnh Facebook

Từ v0.3.3, bước gắn ảnh không còn chỉ tìm `input[type=file]` bên trong dialog.

App thử theo nhiều lớp:
1. input ảnh bên trong composer;
2. input ảnh được Facebook portal ra ngoài dialog;
3. nút **Ảnh/video** theo text, role và aria-label tiếng Việt/Anh;
4. file chooser thật nếu Facebook phát sự kiện chọn file;
5. chờ input ảnh mới xuất hiện sau khi bấm nút.

Nếu Facebook chỉ mở khu vực **Thêm vào bài viết** ở lần bấm đầu, app tiếp tục tìm control ảnh mới và thử lại trong thời gian giới hạn.


## Luồng đăng Facebook đơn giản v0.3.4

Luồng TEST/AUTO được rút gọn theo đúng thao tác thực tế trên Facebook:

1. Mở trang cá nhân.
2. Bấm **Bạn đang nghĩ gì?** để mở composer.
3. Chờ composer ổn định.
4. Kéo/thả ảnh trực tiếp vào vùng soạn bài.
5. Chờ Facebook tạo preview ảnh.
6. Gõ caption bằng keyboard vào focus mà Facebook đã đặt sẵn.
7. Chờ nút **Đăng** sẵn sàng.
8. TEST dừng lại; AUTO mới click **Đăng**.

App không còn cần tìm selector ô nhập caption trong luồng chính. Drag file ưu tiên dùng Chromium CDP; nếu Edge/Chrome không nhận thì fallback sang DOM DataTransfer cùng thao tác drag/drop.

Các khoảng chờ là cố định để giao diện kịp xử lý và tránh mất ký tự/ảnh; không dùng random delay hay kỹ thuật né kiểm tra.


## Sửa kéo-thả ảnh không cần tọa độ v0.3.5

Bản v0.3.4 còn có thể dừng ở lỗi "Không xác định được vùng thả ảnh" vì Facebook không trả bounding box cho phần tử đang focus.

Từ v0.3.5:
- không còn dùng bounding box;
- không còn tính X/Y để thả file;
- tạo DataTransfer chứa ảnh;
- thả trực tiếp vào phần tử Facebook đang focus;
- nếu focus không nhận, thả vào chính dialog Tạo bài viết;
- chỉ tiếp tục sang bước gõ caption khi thấy bằng chứng preview/media mới xuất hiện.

Luồng chính vẫn là: mở composer → thả ảnh → chờ preview → gõ caption bằng keyboard → chờ nút Đăng.
