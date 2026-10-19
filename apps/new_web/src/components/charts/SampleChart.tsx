import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const data = [
  { name: 'Jan', users: 40, funds: 24 },
  { name: 'Feb', users: 30, funds: 13 },
  { name: 'Mar', users: 20, funds: 48 },
  { name: 'Apr', users: 27, funds: 39 },
  { name: 'May', users: 18, funds: 28 },
  { name: 'Jun', users: 23, funds: 38 },
  { name: 'Jul', users: 34, funds: 43 },
];

const SampleChart: React.FC = () => {
  return (
    <div className="bg-white p-6 rounded-lg shadow-soft h-80">
        <h3 className="text-lg font-semibold mb-4">Platform Growth</h3>
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                <XAxis dataKey="name" stroke="#9e9e9e" />
                <YAxis stroke="#9e9e9e" />
                <Tooltip wrapperClassName="rounded-lg shadow-lg" contentStyle={{ backgroundColor: '#ffffff', border: 'none' }} />
                <Legend />
                <Line type="monotone" dataKey="users" stroke="#390364" strokeWidth={2} activeDot={{ r: 8 }} />
                <Line type="monotone" dataKey="funds" stroke="#82ca9d" strokeWidth={2} />
            </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default SampleChart;
