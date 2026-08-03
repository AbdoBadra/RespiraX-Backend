# RespiraX — الباك إند الحقيقي

باك إند حقيقي مبني بـ Node.js + Express + SQLite. فيه:
- تسجيل/دخول حقيقي بكلمات مرور مشفّرة (bcrypt) وتوكن دخول (JWT)
- قاعدة بيانات حقيقية (SQLite) لكل القراءات والمرضى والأطباء
- ربط الطبيب بالمريض بموافقة المريض
- مسارات خاصة بالجهاز (ESP32) لإرسال القراءات عبر الواي فاي

## 1) التشغيل محليًا (على جهازك عشان تجرب)

```bash
cd respirax-backend
npm install
cp .env.example .env
# افتح .env وحط JWT_SECRET عشوائي وطويل
npm start
```

السيرفر هيشتغل على `http://localhost:4000`. جرّبه بفتح `http://localhost:4000/api/health` في المتصفح، المفروض يرجعلك `{"ok":true}`.

## 2) ربطه بالموقع (الفرونت إند)

في ملف `respirax-frontend.html` في أول السكريبت في سطر:
```js
const API_BASE = "http://localhost:4000/api";
```
لما تشغل السيرفر على جهازك، الموقع هيشتغل معاه على طول محليًا. لما تنشر السيرفر (خطوة 3)، غيّر الرابط ده لرابط السيرفر بعد النشر.

## 3) نشر السيرفر عشان يبقى شغال 24 ساعة (مش على جهازك بس)

أسهل وأرخص خيارات مجانية/رخيصة تناسب Node.js + SQLite:
- **Railway** (railway.app) — أسهل واحد، تربط الريبو من GitHub ويشتغل تلقائي
- **Render** (render.com) — نفس الفكرة، فيه باقة مجانية

الخطوات عمومًا:
1. ارفع مجلد `respirax-backend` على GitHub
2. من Railway/Render، اختار "New Project from GitHub"
3. حط متغيرات البيئة (`JWT_SECRET`, `CORS_ORIGIN` = رابط موقعك بعد نشره)
4. هيديك رابط زي `https://respirax-api.up.railway.app`
5. حط الرابط ده بدل `http://localhost:4000/api` في الموقع

⚠️ ملحوظة مهمة: SQLite بيتخزن كملف على السيرفر — على Railway/Render لازم تفعّل "persistent volume/disk" وإلا البيانات ممكن تتمسح كل ما السيرفر يعيد التشغيل. لو عايز حل أضمن للإنتاج الفعلي بعدين، ننقل لـ PostgreSQL (بديل بسيط لأي وقت تحب).

## 4) نشر الموقع (الفرونت إند)

ملف `respirax-frontend.html` ملف واحد بسيط، تقدر:
1. ترفعه على GitHub
2. تربطه بـ Netlify أو Vercel (مجاني) — هيديك رابط تقدر تشيره للناس زي `respirax.netlify.app`

## نقاط الـ API المتاحة

| المسار | طريقة | الوصف |
|---|---|---|
| `/api/auth/signup` | POST | إنشاء حساب (مريض أو دكتور) |
| `/api/auth/login` | POST | تسجيل دخول، بيرجع توكن |
| `/api/patients/me/readings` | GET | كل قراءات المريض المسجّل دخوله |
| `/api/patients/me/readings/demo` | POST | إضافة قراءة تجريبية |
| `/api/patients/me/doctor-requests` | GET | طلبات ربط الأطباء المعلّقة |
| `/api/patients/me/doctor-requests/:id/respond` | POST | موافقة/رفض طلب طبيب |
| `/api/doctors/me/requests` | POST | إرسال طلب ربط لمريض باسم المستخدم |
| `/api/doctors/me/patients` | GET | مرضى الطبيب المرتبطين والموافَق عليهم |
| `/api/doctors/me/patients/:id/readings` | GET | سجل مريض معيّن (بعد الموافقة) |
| `/api/device/register` | POST | الجهاز يسجّل نفسه ويطلب device_secret + كود ربط |
| `/api/device/status` | GET | الجهاز يتأكد لو المستخدم دخل الكود |
| `/api/device/readings` | POST | الجهاز يبعت قراءة حقيقية (بعد الربط) |

مسارات `/api/device/*` جاهزة عشان تستخدمها لما تحب تفعّل ربط الجهاز عن طريق الواي فاي والكود اللي بيظهر على شاشة الـ ESP32 — دي هتحل مشكلة الآيفون كمان لما تكون جاهز ليها.
