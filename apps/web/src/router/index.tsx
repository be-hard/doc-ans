import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";

const DashBoard = lazy(() => import("@/pages/DashBoard"));
const Login = lazy(() => import("@/pages/Login"));

const router = createBrowserRouter([
  {
    path: "/",
    element: <Login />,
  },
  {
    path: "/dashboard",
    element: <DashBoard />,
  },
  {
    path: "/login",
    element: <Login />,
  },
]);

export default router;
