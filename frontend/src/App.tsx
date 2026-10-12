import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { CustomerPage } from "./pages/CustomerPage";
import { CustomersPage } from "./pages/CustomersPage";
import { PlansPage } from "./pages/PlansPage";

export function App() {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">UsageBill</span>
          <nav aria-label="Main">
            <NavLink to="/customers">Customers</NavLink>
            <NavLink to="/plans">Plans</NavLink>
          </nav>
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<Navigate to="/customers" replace />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:customerId" element={<CustomerPage />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="*" element={<p>Page not found. <NavLink to="/customers">Go to customers</NavLink></p>} />
        </Routes>
      </main>
    </>
  );
}
