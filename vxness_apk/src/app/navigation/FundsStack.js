import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FundsScreen from '../../features/funds/screens/FundsScreen';
import DepositScreen from '../../features/funds/screens/DepositScreen';
import DepositManual from '../../features/funds/screens/DepositManual';
import DepositLocalBanking from '../../features/funds/screens/DepositLocalBanking';
import WithdrawManual from '../../features/funds/screens/WithdrawManual';
import TransferScreen from '../../features/funds/screens/TransferScreen';
import TransactionHistoryScreen from '../../features/funds/screens/TransactionHistoryScreen';

const Stack = createNativeStackNavigator();

export default function FundsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#000000' }, animation: 'slide_from_right', animationDuration: 250 }}>
      <Stack.Screen name="Funds" component={FundsScreen} />
      <Stack.Screen name="Deposit" component={DepositScreen} />
      <Stack.Screen name="DepositManual" component={DepositManual} />
      <Stack.Screen name="DepositLocalBanking" component={DepositLocalBanking} />
      {/* "Withdraw" opens the withdrawal form itself.
          
          It used to open a chooser headed "Choose withdrawal method" that
          listed exactly one option and did nothing but forward to this screen —
          a tap and a screen transition that asked the user nothing. The website
          opens the form straight away, so this does too. The old route name is
          kept pointing at the same screen so any existing link still resolves. */}
      <Stack.Screen name="Withdraw" component={WithdrawManual} />
      <Stack.Screen name="WithdrawManual" component={WithdrawManual} />
      <Stack.Screen name="Transfer" component={TransferScreen} />
      <Stack.Screen name="TransactionHistory" component={TransactionHistoryScreen} />
    </Stack.Navigator>
  );
}
