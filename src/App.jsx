import { useState } from "react";
import reactLogo from "./assets/react.svg";
import viteLogo from "/vite.svg";
import "./App.css";
import Animes from "../public/Rss.json";

function App() {
  const [count, setCount] = useState(0);

  return (
    <>
      <div>
        {Animes.items.map((torrents) => (
          <div>{torrents.title}</div>
        ))}
      </div>
    </>
  );
}

export default App;
