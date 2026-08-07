import Sidebar from "@/components/Sidebar";

export default function AccountLayout({ children }) {
  return (
    <div className="layout-with-sidebar">
      <Sidebar />
      <main className="main-content">{children}</main>
    </div>
  );
}
