"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCreatePotStore } from "@/features/create-pot/store";
import { toast } from "@/features/toast/store";
import {
  useElectricityProviders,
  useCableProviders,
  useCablePlans,
  useLookupElectricityCustomer,
  useLookupCableCustomer
} from "@/features/create-pot/hooks";
import { usePayoutAccounts } from "@/features/settings/payout-hooks";
import { Loader2, Landmark, Zap, Tv, ShieldCheck } from "lucide-react";
import { SelectSheet } from "@/components/ui/select-sheet";


export default function CreatePotPage() {
  const router = useRouter();
  const store = useCreatePotStore();

  const { data: payoutData, isPending: loadingPayouts } = usePayoutAccounts();
  const { data: discos, isPending: loadingDiscos } = useElectricityProviders();
  const { data: cableProviders, isPending: loadingCableProv } = useCableProviders();
  const { data: cablePlans, isPending: loadingCablePlans } = useCablePlans(store.billerProductCode);

  const lookupElectricity = useLookupElectricityCustomer();
  const lookupCable = useLookupCableCustomer();


  const [bvnNotice, setBvnNotice] = useState(false);

  // Auto-set primary payout account if bank_payout is selected
  useEffect(() => {
    if (store.settlementType === "bank_payout" && payoutData?.accounts) {
      const primary = payoutData.accounts.find((a) => a.isPrimary) || payoutData.accounts[0];
      if (primary) {
        store.setField("payoutAccountId", primary.id);
      }
    }
  }, [store.settlementType, payoutData]);

  // Lookup validation & trigger
  const isVerifying = lookupElectricity.isPending || lookupCable.isPending;

  function handleVerifyBiller() {
    store.setField("billerCustomerName", undefined);

    if (!store.billerProductCode) {
      toast.error("Please select a provider.");
      return;
    }
    if (!store.billerCustomerId) {
      toast.error("Please enter the customer ID / meter / smartcard number.");
      return;
    }

    if (store.billerCategory === "electricity") {
      if (!store.meterType) {
        toast.error("Please select a meter type.");
        return;
      }
      lookupElectricity.mutate(
        {
          disco: store.billerProductCode,
          customerId: store.billerCustomerId,
          meterType: store.meterType
        },
        {
          onSuccess: (res) => {
            store.setField("billerCustomerName", res.customerName);
          },
          onError: (err: Error) => {
            toast.error(err.message ?? "Meter verification failed. Check the details.");
          }
        }
      );
    } else {
      lookupCable.mutate(
        {
          cableTvType: store.billerProductCode,
          customerId: store.billerCustomerId
        },
        {
          onSuccess: (res) => {
            store.setField("billerCustomerName", res.customerName);
          },
          onError: (err: Error) => {
            toast.error(err.message ?? "Smartcard verification failed. Check the details.");
          }
        }
      );
    }
  }

  function handleNext() {
    if (store.settlementType === "bank_payout") {
      if (!store.payoutAccountId) {
        toast.error("Please select or add a payout account.");
        return;
      }
    } else {
      if (!store.billerCategory) {
        toast.error("Please select a bill category.");
        return;
      }
      if (!store.billerProductCode) {
        toast.error("Please select a provider/plan.");
        return;
      }
      if (!store.billerCustomerId) {
        toast.error("Please enter customer ID.");
        return;
      }
      if (!store.billerCustomerName) {
        toast.error("Please verify the biller account before proceeding.");
        return;
      }
    }

    router.push("/pots/split");
  }

  return (
    <div className="w-full flex flex-col pb-6">
      {/* HEADER */}
      <div className="flex items-center justify-between w-full">
        <h1 className="text-2xl font-black text-ink tracking-tight">Create Pot</h1>
        <span className="text-xs font-bold text-ink/50 bg-ink/5 px-2.5 py-1 rounded-full">
          Step 1/3
        </span>
      </div>



      {/* SETTLEMENT TYPE PICKER */}
      <div className="mt-5 flex flex-col gap-2">
        <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
          How will collected funds be settled?
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              store.setField("settlementType", "bill_payment");
              store.setField("billerCategory", "electricity");
            }}
            className={`p-4 rounded-2xl border-2 text-left flex flex-col gap-2.5 transition-all shadow-sm ${
              store.settlementType === "bill_payment"
                ? "border-primary bg-primary/5"
                : "border-slate-100 bg-white"
            }`}
          >
            <div className="p-2 rounded-xl bg-ink/5 text-ink w-fit">
              <Zap className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-black text-ink">Bill Payment</span>
              <span className="text-[10px] font-semibold text-ink/40 mt-0.5">Pay electricity/cable directly</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => {
              store.setField("settlementType", "bank_payout");
              store.setField("billerCategory", undefined);
            }}
            className={`p-4 rounded-2xl border-2 text-left flex flex-col gap-2.5 transition-all shadow-sm ${
              store.settlementType === "bank_payout"
                ? "border-primary bg-primary/5"
                : "border-slate-100 bg-white"
            }`}
          >
            <div className="p-2 rounded-xl bg-ink/5 text-ink w-fit">
              <Landmark className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-black text-ink">Bank Payout</span>
              <span className="text-[10px] font-semibold text-ink/40 mt-0.5">Withdraw settled cash to bank</span>
            </div>
          </button>
        </div>
      </div>

      {/* BANK PAYOUT FIELDS */}
      {store.settlementType === "bank_payout" && (
        <div className="mt-5 flex flex-col gap-4 bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
          <div className="flex flex-col gap-1.5">
            {loadingPayouts ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : payoutData?.accounts && payoutData.accounts.length > 0 ? (
              <SelectSheet
  label="Select Payout Account"
  placeholder="Choose account..."
  loading={loadingPayouts}
  options={(payoutData?.accounts ?? []).map((acc) => ({
    label: `${acc.bankName} — ${acc.accountName}`,
    value: acc.id,
    sublabel: `**** ${acc.accountNumberLast4}`,
  }))}
  value={store.payoutAccountId ?? ""}
  onChange={(val) => store.setField("payoutAccountId", val)}
/>
            ) : (
              <div className="text-center py-4 flex flex-col gap-2">
                <p className="text-xs font-bold text-danger">No payout accounts found.</p>
                <button
                  type="button"
                  onClick={() => router.push("/settings/payout")}
                  className="mx-auto w-fit px-4 py-2 bg-primary border-2 border-ink shadow-[2px_2px_0px_0px_#111827] rounded-xl text-xs font-black text-ink"
                >
                  Add Payout Account
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* BILL PAYMENT FIELDS */}
      {store.settlementType === "bill_payment" && (
        <div className="mt-5 flex flex-col gap-4 bg-white border border-slate-100 p-4 rounded-2xl shadow-sm">
          {/* Bill Category Toggle */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
              Bill Category
            </label>
            <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
              <button
                type="button"
                onClick={() => {
                  store.setField("billerCategory", "electricity");
                  store.setField("billerProductCode", undefined);
                  store.setField("billerCustomerId", undefined);
                  store.setField("billerCustomerName", undefined);
                  store.setField("meterType", "PREPAID");
                }}
                className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                  store.billerCategory === "electricity" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
                }`}
              >
                <Zap className="h-3.5 w-3.5" />
                Electricity
              </button>
              <button
                type="button"
                onClick={() => {
                  store.setField("billerCategory", "cable");
                  store.setField("billerProductCode", undefined);
                  store.setField("billerCustomerId", undefined);
                  store.setField("billerCustomerName", undefined);
                  store.setField("meterType", undefined);
                }}
                className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                  store.billerCategory === "cable" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
                }`}
              >
                <Tv className="h-3.5 w-3.5" />
                Cable TV
              </button>
            </div>
          </div>

          {/* Provider Select */}
          <div className="flex flex-col gap-1.5">
            {store.billerCategory === "electricity" ? (
              loadingDiscos ? (
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
              ) : (
                <SelectSheet
  label="Provider"
  placeholder="Select Disco..."
  loading={loadingDiscos}
  options={(discos ?? []).map((d) => ({ label: d.name, value: d.code }))}
  value={store.billerProductCode ?? ""}
  onChange={(val) => {
    store.setField("billerProductCode", val);
    store.setField("billerCustomerName", undefined);
  }}
/>
              )
            ) : loadingCableProv ? (
              <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
            ) : (
              <SelectSheet
  label="Provider"
  placeholder="Select Provider..."
  loading={loadingCableProv}
  options={(cableProviders ?? []).map((c) => ({ label: c.name, value: c.code }))}
  value={store.billerProductCode ?? ""}
  onChange={(val) => {
    store.setField("billerProductCode", val);
    store.setField("billerCustomerName", undefined);
  }}
/>
            )}
          </div>

          {/* Cable Plans (If Category is Cable and Provider is selected) */}
          {store.billerCategory === "cable" && store.billerProductCode && (
            <div className="flex flex-col">
              {loadingCablePlans ? (
                <Loader2 className="h-5 w-5 animate-spin mx-auto text-primary" />
              ) : (
                <SelectSheet
  label="Bouquet / Plan"
  placeholder="Select Bouquet..."
  loading={loadingCablePlans}
  options={(cablePlans ?? []).map((p) => ({
    label: p.name,
    value: p.code,
    sublabel: `₦${((p.amountKobo ?? 0) / 100).toLocaleString()}`,
  }))}
  value={""}
  onChange={(planCode) => {
    const plan = cablePlans?.find((p) => p.code === planCode);
    if (plan) {
      store.setField("totalKobo", plan.amountKobo ?? 0);
      store.setField("description", `Bouquet: ${plan.name}`);
    }
  }}
/>
              )}
            </div>
          )}

          {/* Meter Type (Only for Electricity) */}
          {store.billerCategory === "electricity" && (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
                Meter Type
              </label>
              <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
                <button
                  type="button"
                  onClick={() => store.setField("meterType", "PREPAID")}
                  className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center transition-all ${
                    store.meterType === "PREPAID" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
                  }`}
                >
                  PREPAID
                </button>
                <button
                  type="button"
                  onClick={() => store.setField("meterType", "POSTPAID")}
                  className={`py-2 rounded-lg text-xs font-extrabold flex items-center justify-center transition-all ${
                    store.meterType === "POSTPAID" ? "bg-white text-ink border border-slate-100 shadow-xs" : "text-ink/40"
                  }`}
                >
                  POSTPAID
                </button>
              </div>
            </div>
          )}

          {/* Customer / Smartcard / Meter Number */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-extrabold uppercase tracking-wider text-ink/40 px-1">
              {store.billerCategory === "electricity" ? "Meter Number" : "Smartcard / Decoder Number"}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={store.billerCustomerId || ""}
                onChange={(e) => {
                  store.setField("billerCustomerId", e.target.value.replace(/\D/g, ""));
                  store.setField("billerCustomerName", undefined);
                }}
                disabled={isVerifying}
                placeholder={store.billerCategory === "electricity" ? "e.g. 0101234567" : "e.g. 1023456789"}
                className="flex-1 bg-white border-2 border-ink rounded-xl px-4 py-3.5 text-sm font-semibold text-ink focus:outline-hidden focus:border-primary shadow-[2px_2px_0px_0px_#111827]"
              />
              <button
                type="button"
                onClick={handleVerifyBiller}
                disabled={isVerifying || !store.billerCustomerId}
                className="px-4 py-3 bg-primary border-2 border-ink shadow-[2px_2px_0px_0px_#111827] rounded-xl text-xs font-black text-ink active:translate-y-[1px] active:shadow-[1px_1px_0px_0px_#111827] disabled:opacity-50 transition-all shrink-0"
              >
                {isVerifying ? <Loader2 className="h-4 w-4 animate-spin text-ink" /> : "Verify"}
              </button>
            </div>
          </div>

          {/* Verified Customer Name Banner */}
          {store.billerCustomerName && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2 text-green-900">
              <ShieldCheck className="h-4 w-4 text-green-700 shrink-0" />
              <div className="flex flex-col text-left">
                <span className="text-[9px] font-bold text-green-700 uppercase tracking-wider">Account Verified</span>
                <span className="text-xs font-extrabold">{store.billerCustomerName}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FOOTER ACTION */}
      <button
        type="button"
        onClick={handleNext}
        className="mt-6 w-full rounded-2xl bg-primary py-4 px-4 font-bold text-ink text-base flex items-center justify-center gap-2 border-2 border-ink shadow-[0_4px_0px_0px_#111827] active:translate-y-[2px] active:shadow-[0_2px_0px_0px_#111827] transition-all select-none"
      >
        <span>Continue to Splits</span>
        <span className="text-lg">➔</span>
      </button>
    </div>
  );
}
