import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { IconPlans, IconUsers, LogoMark } from "./components/icons";
import { CustomerPage } from "./pages/CustomerPage";
import { CustomersPage } from "./pages/CustomersPage";
import { PlansPage } from "./pages/PlansPage";

export function App() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <LogoMark />
          <span>UsageBill</span>
        </div>
        <nav aria-label="Main">
          <NavLink to="/customers">
            <IconUsers /> Customers
          </NavLink>
          <NavLink to="/plans">
            <IconPlans /> Plans
          </NavLink>
        </nav>
      </aside>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/customers" replace />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:customerId" element={<CustomerPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="*" element={<p>Page not found. <NavLink to="/customers">Go to customers</NavLink></p>} />
        </Routes>
      </main>
    </div>
  );
}
