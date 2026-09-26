import { Fragment } from "react";

import { Link } from "react-router-dom";

import type { BreadcrumbItem } from "../lib/seo";

function Breadcrumbs({
  items,
}: {
  items: BreadcrumbItem[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        {items.map((item, index) => {
          const isLast =
            index === items.length - 1;

          return (
            <Fragment key={item.path}>
              {index > 0 && (
                <li
                  aria-hidden="true"
                  className="text-gray-300"
                >
                  /
                </li>
              )}

              <li>
                {isLast ? (
                  <span
                    aria-current="page"
                    className="font-medium text-gray-700"
                  >
                    {item.name}
                  </span>
                ) : (
                  <Link
                    to={item.path}
                    className="hover:text-gray-900 hover:underline"
                  >
                    {item.name}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumbs;
