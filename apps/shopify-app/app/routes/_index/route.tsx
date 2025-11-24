import type { LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>OrbitCheck</h1>
        <p className={styles.text}>
          Validate customer information and detect high-risk orders automatically.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop Domain</span>
              <input
                className={styles.input}
                type="text"
                name="shop"
                placeholder="my-shop.myshopify.com"
                required
              />
              <span>Enter your Shopify store domain to log in</span>
            </label>
            <button className={styles.button} type="submit">
              Log in with Shopify
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Automatic Validation</strong>
            Instantly validate shipping addresses and customer details for every new order.
          </li>
          <li>
            <strong>Risk Detection</strong>
            Identify high-risk orders with our advanced fraud detection algorithms.
          </li>
          <li>
            <strong>Seamless Integration</strong>
            Works directly within your Shopify admin. No complex setup required.
          </li>
        </ul>
      </div>
    </div>
  );
}
