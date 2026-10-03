import type { Level } from "./permissions";

export interface Store { id: string; name: string; }
export interface Staff {
  id: string; name: string; email: string; storeId: string; level: Level;
  status: "active" | "disabled"; paidLeaveLeft: number;
}

export const DEMO_STORES: Store[] = [
  { id: "s1", name: "ATENA" },
  { id: "s2", name: "ATENA六本松" },
  { id: "s3", name: "ATENA福津" },
  { id: "s4", name: "Organ" },
  { id: "s5", name: "ATENA AVEDA SAKURAMACHI" },
];

export const DEMO_STAFF: Staff[] = [
  { id: "u1", name: "事務員（オフィス）", email: "office@example.com", storeId: "s1", level: 4, status: "active", paidLeaveLeft: 10 },
  { id: "u2", name: "店長（ATENA）", email: "manager@example.com", storeId: "s1", level: 3, status: "active", paidLeaveLeft: 8 },
  { id: "u3", name: "シフト担当（ATENA）", email: "shift@example.com", storeId: "s1", level: 2, status: "active", paidLeaveLeft: 6 },
  { id: "u4", name: "大坪", email: "otsubo@example.com", storeId: "s1", level: 1, status: "active", paidLeaveLeft: 12 },
  { id: "u5", name: "永尾", email: "nagao@example.com", storeId: "s1", level: 1, status: "active", paidLeaveLeft: 8 },
  { id: "u6", name: "山田", email: "yamada@example.com", storeId: "s2", level: 1, status: "active", paidLeaveLeft: 5 },
  { id: "u7", name: "店長（六本松）", email: "manager2@example.com", storeId: "s2", level: 3, status: "active", paidLeaveLeft: 9 },
  { id: "u8", name: "退職した人", email: "gone@example.com", storeId: "s1", level: 1, status: "disabled", paidLeaveLeft: 0 },
];
