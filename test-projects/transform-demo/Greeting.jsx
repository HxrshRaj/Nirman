import { formatName } from './format';

export const Greeting = ({ name, unread }) => {
  const label = `Hello, ${formatName(name)}!`;
  return (
    <div className="greeting">
      <h1>{label}</h1>
      {unread > 0 && <span className="badge">{unread} new</span>}
      <ul>
        {['a', 'b', 'c'].map((item) => (
          <li key={item}>{item.toUpperCase()}</li>
        ))}
      </ul>
    </div>
  );
};

export default Greeting;
