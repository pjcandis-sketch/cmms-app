export const PERMISSIONS = [
  { id: "devices.write", label: "ثبت و ویرایش دستگاه‌ها" },
  { id: "checklist.write", label: "مدیریت چک‌لیست‌ها" },
  { id: "workorders.write", label: "ثبت سفارش تعمیر" },
  { id: "users.manage", label: "مدیریت کاربران و نقش‌ها" },
  { id: "approvals.decide", label: "تأیید درخواست‌ها" },
  { id: "audit.view", label: "مشاهده گزارش فعالیت" },
];

export function hasPerm(user, perm) {
  if (!user) return false;
  return user.permissions.includes("*") || user.permissions.includes(perm);
}
